import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { CompletedTaskFilter } from "@/lib/types";

const testDataDirectory = mkdtempSync(path.join(tmpdir(), "task-board-db-"));
const testDatabasePath = path.join(testDataDirectory, "task-board.sqlite");
process.env.TASK_BOARD_DATA_DIR = testDataDirectory;

const legacyDatabase = new DatabaseSync(testDatabasePath);
legacyDatabase.exec(`
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('requirement', 'bug', 'support')),
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT
  );
  CREATE TABLE task_images (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL
  );
  INSERT INTO tasks VALUES (
    'legacy-task', '迁移保留任务', 'bug', 'todo', '旧任务详情',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
  );
  INSERT INTO task_links VALUES ('legacy-link', 'legacy-task', 'https://example.com/legacy', '旧链接');
  INSERT INTO task_images VALUES (
    'legacy-image', 'legacy-task', 'legacy.png', 'image/png', 128, '/tmp/legacy.png'
  );
`);
legacyDatabase.close();

type DatabaseModule = typeof import("@/lib/db");
let databaseModule: DatabaseModule | null = null;

async function getDatabaseModule(): Promise<DatabaseModule> {
  databaseModule ??= await import("@/lib/db");
  return databaseModule;
}

async function allTasks(view: "open" | "completed", filter?: CompletedTaskFilter) {
  const { listTaskGroups } = await getDatabaseModule();
  return listTaskGroups(view, filter).flatMap((group) => group.tasks);
}

test("migrates the legacy schema without losing task data", async () => {
  const { getTask } = await getDatabaseModule();
  const task = getTask("legacy-task");
  assert.equal(task.description, "旧任务详情");
  assert.equal(task.solution, "");
  assert.equal(task.supportAgent, null);
  assert.equal(task.links[0]?.title, "旧链接");
  assert.equal(task.images[0]?.fileName, "legacy.png");

  const database = new DatabaseSync(testDatabasePath);
  const columns = database.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === "solution"), true);
  assert.equal(columns.some((column) => column.name === "support_agent_id"), true);
  database.close();
});

test("stores support agents, assignments, and task solutions", async () => {
  const {
    createSupportAgentRecord,
    createTaskRecord,
    listSupportAgentRecords,
    updateTaskRecord,
  } = await getDatabaseModule();
  const agent = createSupportAgentRecord({ name: "  Alice  " });
  assert.equal(agent.name, "Alice");
  assert.equal(listSupportAgentRecords().some((item) => item.id === agent.id), true);
  assert.throws(() => createSupportAgentRecord({ name: "alice" }), /客服已存在/);

  const bug = createTaskRecord({
    title: "客服关联测试",
    category: "bug",
    description: "问题背景",
    solution: "  重新同步数据  ",
    supportAgentId: agent.id,
  });
  assert.equal(bug.solution, "重新同步数据");
  assert.equal(bug.supportAgent?.id, agent.id);

  const ordinaryEdit = updateTaskRecord(bug.id, { title: "客服关联测试（已编辑）" });
  assert.equal(ordinaryEdit.solution, "重新同步数据");
  assert.equal(ordinaryEdit.supportAgent?.id, agent.id);

  const movedToSupport = updateTaskRecord(bug.id, { category: "support" });
  assert.equal(movedToSupport.supportAgent?.id, agent.id);
  const movedToRequirement = updateTaskRecord(bug.id, { category: "requirement" });
  assert.equal(movedToRequirement.supportAgent, null);
  assert.throws(
    () => updateTaskRecord(bug.id, { category: "bug", supportAgentId: "missing-agent" }),
    /客服不存在/,
  );
});

test("bulk deletes tasks and cascades links and image records", async () => {
  const {
    addTaskLinkRecord,
    createTaskRecord,
    deleteTaskRecords,
    getTask,
    insertTaskImage,
  } = await getDatabaseModule();
  const first = createTaskRecord({ title: "批量删除一", category: "requirement" });
  const second = createTaskRecord({ title: "批量删除二", category: "bug" });
  const untouched = createTaskRecord({ title: "保留任务", category: "support" });
  addTaskLinkRecord(first.id, { url: "https://example.com/delete", title: "待删除链接" });
  insertTaskImage({
    id: "delete-image-one",
    taskId: first.id,
    fileName: "one.png",
    mimeType: "image/png",
    sizeBytes: 128,
    storagePath: "/tmp/delete-image-one.png",
  });
  insertTaskImage({
    id: "delete-image-two",
    taskId: second.id,
    fileName: "two.png",
    mimeType: "image/png",
    sizeBytes: 256,
    storagePath: "/tmp/delete-image-two.png",
  });

  const result = deleteTaskRecords([first.id, first.id, "missing-task", second.id]);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(result.storagePaths.sort(), ["/tmp/delete-image-one.png", "/tmp/delete-image-two.png"]);
  assert.throws(() => getTask(first.id), /任务不存在/);
  assert.throws(() => getTask(second.id), /任务不存在/);
  assert.equal(getTask(untouched.id).title, "保留任务");

  const database = new DatabaseSync(testDatabasePath);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM task_links WHERE task_id = ?").get(first.id)?.count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM task_images WHERE task_id IN (?, ?)").get(first.id, second.id)?.count, 0);
  database.close();
  assert.throws(() => deleteTaskRecords([]), /请选择要删除的任务/);
  assert.throws(() => deleteTaskRecords([" "]), /任务 ID 无效/);
});

test("records task times and updates completion timestamps with status", async () => {
  const { createTaskRecord, updateTaskRecord } = await getDatabaseModule();
  const task = createTaskRecord({ title: "时间记录测试", category: "requirement" });
  assert.ok(task.createdAt);
  assert.equal(task.completedAt, null);

  const completed = updateTaskRecord(task.id, { status: "done" });
  assert.ok(completed.completedAt);
  assert.equal(completed.createdAt, task.createdAt);

  const historical = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const edited = updateTaskRecord(task.id, { completedAt: historical });
  assert.equal(edited.completedAt, historical);

  const reopened = updateTaskRecord(task.id, { status: "todo" });
  assert.equal(reopened.completedAt, null);
  const completedAgain = updateTaskRecord(task.id, { status: "done" });
  assert.ok(completedAgain.completedAt);
  assert.notEqual(completedAgain.completedAt, historical);
  assert.throws(
    () => updateTaskRecord(task.id, { completedAt: new Date(Date.now() + 60_000).toISOString() }),
    /不能晚于当前时间/,
  );
});

test("filters completed tasks by rolling ranges and sorts by completion time", async () => {
  const { createTaskRecord, updateTaskRecord } = await getDatabaseModule();
  const recent = createTaskRecord({ title: "最近完成", category: "bug" });
  const older = createTaskRecord({ title: "较早完成", category: "support" });
  const newest = createTaskRecord({ title: "最新完成", category: "requirement" });
  const openTask = createTaskRecord({ title: "仍待处理", category: "support" });
  const recentAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const olderAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const newestAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  updateTaskRecord(recent.id, { status: "done", completedAt: recentAt });
  updateTaskRecord(older.id, { status: "done", completedAt: olderAt });
  updateTaskRecord(newest.id, { status: "done", completedAt: newestAt });

  const weekTasks = await allTasks("completed", { preset: "week" });
  const relevantWeekTasks = weekTasks.filter((task) => ["最新完成", "最近完成", "较早完成"].includes(task.title));
  assert.deepEqual(relevantWeekTasks.map((task) => task.title), ["最新完成", "最近完成"]);
  assert.equal(weekTasks.some((task) => task.title === "较早完成"), false);

  const allCompleted = await allTasks("completed", { preset: "all" });
  assert.equal(allCompleted.some((task) => task.title === "较早完成"), true);
  const customTasks = await allTasks("completed", {
    preset: "custom",
    from: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.deepEqual(customTasks.map((task) => task.title), ["最近完成"]);
  assert.equal((await allTasks("open", { preset: "custom" })).some((task) => task.id === openTask.id), true);
});
