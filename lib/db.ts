import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CATEGORY_META,
  TASK_CATEGORIES,
  type BoardView,
  type CompletedTaskFilter,
  type CreateSupportAgentInput,
  type CreateTaskInput,
  type CreateTaskLinkInput,
  type CreateTaskTagInput,
  type SupportAgent,
  type Task,
  type TaskCategory,
  type TaskGroup,
  type TaskImage,
  type TaskLink,
  type TaskStatus,
  type TaskTag,
  type TaskTagColor,
  type UpdateTaskInput,
  type UpdateTaskTagInput,
} from "@/lib/types";
import {
  assertCategory,
  assertStatus,
  assertTaskTagColor,
  normalizeCompletedAt,
  normalizeCompletedTaskFilter,
  normalizeSupportAgentName,
  normalizeTaskTagName,
  normalizeTitle,
  normalizeUrl,
} from "@/lib/validation";

type TaskRow = {
  id: string;
  title: string;
  category: TaskCategory;
  status: TaskStatus;
  description: string;
  solution: string;
  support_agent_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type LinkRow = {
  id: string;
  url: string;
  title: string | null;
};

type ImageRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
};

type StoredImage = ImageRow & { task_id: string };

type SupportAgentRow = {
  id: string;
  name: string;
  created_at: string;
};

type TaskTagRow = {
  id: string;
  name: string;
  color: TaskTagColor;
  created_at: string;
};

const dataDirectory = process.env.TASK_BOARD_DATA_DIR ?? path.join(process.cwd(), ".data");
const databasePath = path.join(dataDirectory, "task-board.sqlite");

const databaseGlobal = globalThis as typeof globalThis & {
  taskBoardDatabase?: DatabaseSync;
};

function getDatabase(): DatabaseSync {
  if (!databaseGlobal.taskBoardDatabase) {
    mkdirSync(dataDirectory, { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS support_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('requirement', 'bug', 'support')),
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
        description TEXT NOT NULL DEFAULT '',
        solution TEXT NOT NULL DEFAULT '',
        support_agent_id TEXT REFERENCES support_agents(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        color TEXT NOT NULL CHECK (color IN ('gray', 'blue', 'green', 'amber', 'red', 'teal')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS task_tags_tag_index ON task_tags (tag_id);

      CREATE INDEX IF NOT EXISTS tasks_view_index
        ON tasks (status, category, updated_at DESC);

      CREATE INDEX IF NOT EXISTS tasks_completed_index
        ON tasks (status, completed_at DESC, category);

      CREATE TABLE IF NOT EXISTS task_links (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title TEXT
      );

      CREATE TABLE IF NOT EXISTS task_images (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_path TEXT NOT NULL
      );
    `);

    const taskColumns = new Set(
      (database.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!taskColumns.has("solution")) {
      database.exec("ALTER TABLE tasks ADD COLUMN solution TEXT NOT NULL DEFAULT ''");
    }
    if (!taskColumns.has("support_agent_id")) {
      database.exec(
        "ALTER TABLE tasks ADD COLUMN support_agent_id TEXT REFERENCES support_agents(id) ON DELETE SET NULL",
      );
    }
    databaseGlobal.taskBoardDatabase = database;
  }
  return databaseGlobal.taskBoardDatabase;
}

function mapLink(row: LinkRow): TaskLink {
  return { id: row.id, url: row.url, title: row.title };
}

function mapImage(row: ImageRow): TaskImage {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: `/uploads/${row.id}`,
  };
}

function mapSupportAgent(row: SupportAgentRow): SupportAgent {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function mapTaskTag(row: TaskTagRow): TaskTag {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at };
}

function getSupportAgentRow(id: string): SupportAgentRow {
  const row = getDatabase()
    .prepare("SELECT id, name, created_at FROM support_agents WHERE id = ?")
    .get(id) as SupportAgentRow | undefined;
  if (!row) {
    throw new Error("客服不存在");
  }
  return row;
}

function getTaskTagRow(id: string): TaskTagRow {
  const row = getDatabase()
    .prepare("SELECT id, name, color, created_at FROM tags WHERE id = ?")
    .get(id) as TaskTagRow | undefined;
  if (!row) {
    throw new Error("标签不存在");
  }
  return row;
}

function normalizeTaskTagIds(values: string[]): string[] {
  if (!Array.isArray(values)) {
    throw new Error("任务标签无效");
  }
  const ids = [...new Set(values.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("标签 ID 无效");
    }
    return value.trim();
  }))];
  ids.forEach(getTaskTagRow);
  return ids;
}

function normalizeSupportAgentId(category: TaskCategory, value: string | null | undefined): string | null {
  if (category === "requirement" || value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("客服无效");
  }
  const id = value.trim();
  if (!id) {
    return null;
  }
  getSupportAgentRow(id);
  return id;
}

function getTaskRow(id: string): TaskRow {
  const row = getDatabase()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow | undefined;
  if (!row) {
    throw new Error("任务不存在");
  }
  return row;
}

function getTaskLinks(id: string): TaskLink[] {
  const rows = getDatabase()
    .prepare("SELECT id, url, title FROM task_links WHERE task_id = ? ORDER BY rowid DESC")
    .all(id) as LinkRow[];
  return rows.map(mapLink);
}

function getTaskImages(id: string): TaskImage[] {
  const rows = getDatabase()
    .prepare(
      "SELECT id, file_name, mime_type, size_bytes, storage_path FROM task_images WHERE task_id = ? ORDER BY rowid DESC",
    )
    .all(id) as ImageRow[];
  return rows.map(mapImage);
}

function getTaskTags(id: string): TaskTag[] {
  const rows = getDatabase()
    .prepare(
      `SELECT tags.id, tags.name, tags.color, tags.created_at
       FROM task_tags
       JOIN tags ON tags.id = task_tags.tag_id
       WHERE task_tags.task_id = ?
       ORDER BY tags.created_at, tags.rowid`,
    )
    .all(id) as TaskTagRow[];
  return rows.map(mapTaskTag);
}

function replaceTaskTags(taskId: string, tagIds: string[]): void {
  const database = getDatabase();
  database.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
  const insert = database.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)");
  tagIds.forEach((tagId) => insert.run(taskId, tagId));
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    description: row.description,
    solution: row.solution,
    supportAgent: row.support_agent_id ? mapSupportAgent(getSupportAgentRow(row.support_agent_id)) : null,
    tags: getTaskTags(row.id),
    links: getTaskLinks(row.id),
    images: getTaskImages(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function getTask(id: string): Task {
  return mapTask(getTaskRow(id));
}

export function listSupportAgentRecords(): SupportAgent[] {
  const rows = getDatabase()
    .prepare("SELECT id, name, created_at FROM support_agents ORDER BY created_at, rowid")
    .all() as SupportAgentRow[];
  return rows.map(mapSupportAgent);
}

export function createSupportAgentRecord(input: CreateSupportAgentInput): SupportAgent {
  const name = normalizeSupportAgentName(input.name);
  const existing = getDatabase()
    .prepare("SELECT id FROM support_agents WHERE name = ? COLLATE NOCASE")
    .get(name);
  if (existing) {
    throw new Error("客服已存在");
  }
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDatabase()
    .prepare("INSERT INTO support_agents (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, name, createdAt);
  return { id, name, createdAt };
}

export function listTaskTagRecords(): TaskTag[] {
  const rows = getDatabase()
    .prepare("SELECT id, name, color, created_at FROM tags ORDER BY created_at, rowid")
    .all() as TaskTagRow[];
  return rows.map(mapTaskTag);
}

export function createTaskTagRecord(input: CreateTaskTagInput): TaskTag {
  const name = normalizeTaskTagName(input.name);
  assertTaskTagColor(input.color);
  const existing = getDatabase().prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(name);
  if (existing) {
    throw new Error("标签已存在");
  }
  const tag = { id: randomUUID(), name, color: input.color, createdAt: new Date().toISOString() };
  getDatabase()
    .prepare("INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)")
    .run(tag.id, tag.name, tag.color, tag.createdAt);
  return tag;
}

export function updateTaskTagRecord(id: string, input: UpdateTaskTagInput): TaskTag {
  getTaskTagRow(id);
  const name = normalizeTaskTagName(input.name);
  assertTaskTagColor(input.color);
  const existing = getDatabase()
    .prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?")
    .get(name, id);
  if (existing) {
    throw new Error("标签已存在");
  }
  getDatabase().prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?").run(name, input.color, id);
  return mapTaskTag(getTaskTagRow(id));
}

export function deleteTaskTagRecord(id: string): void {
  getTaskTagRow(id);
  getDatabase().prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function listTaskGroups(view: BoardView, filter: CompletedTaskFilter = { preset: "week" }): TaskGroup[] {
  const database = getDatabase();
  const where = [view === "completed" ? "status = 'done'" : "status != 'done'"];
  const parameters: string[] = [];
  if (view === "completed") {
    const normalizedFilter = normalizeCompletedTaskFilter(filter);
    if (normalizedFilter.preset !== "all") {
      const now = Date.now();
      const from = normalizedFilter.preset === "week"
        ? new Date(now - 7 * 24 * 60 * 60 * 1000)
        : normalizedFilter.preset === "month"
          ? new Date(now - 30 * 24 * 60 * 60 * 1000)
          : new Date(normalizedFilter.from as string);
      const to = normalizedFilter.preset === "custom" ? new Date(normalizedFilter.to as string) : new Date(now);
      where.push("completed_at >= ? AND completed_at < ?");
      parameters.push(from.toISOString(), to.toISOString());
    }
  }
  const orderBy = view === "completed" ? "completed_at DESC" : "updated_at DESC";
  const rows = database
    .prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`)
    .all(...parameters) as TaskRow[];
  const tasksByCategory = new Map<TaskCategory, Task[]>();
  for (const category of TASK_CATEGORIES) {
    tasksByCategory.set(category, []);
  }
  for (const row of rows) {
    tasksByCategory.get(row.category)?.push(mapTask(row));
  }
  return TASK_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_META[category].label,
    description: CATEGORY_META[category].description,
    tasks: tasksByCategory.get(category) ?? [],
  }));
}

export function createTaskRecord(input: CreateTaskInput): Task {
  const title = normalizeTitle(input.title);
  assertCategory(input.category);
  const status = input.status ?? "todo";
  assertStatus(status);
  const supportAgentId = normalizeSupportAgentId(input.category, input.supportAgentId);
  const tagIds = normalizeTaskTagIds(input.tagIds ?? []);
  const now = new Date().toISOString();
  const id = randomUUID();
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO tasks
          (id, title, category, status, description, solution, support_agent_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        title,
        input.category,
        status,
        input.description?.trim() ?? "",
        input.solution?.trim() ?? "",
        supportAgentId,
        now,
        now,
        status === "done" ? now : null,
      );
    replaceTaskTags(id, tagIds);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getTask(id);
}

export function updateTaskRecord(id: string, input: UpdateTaskInput): Task {
  const existing = getTaskRow(id);
  const nextTitle = input.title === undefined ? existing.title : normalizeTitle(input.title);
  const nextCategory = input.category === undefined ? existing.category : input.category;
  const nextStatus = input.status === undefined ? existing.status : input.status;
  assertCategory(nextCategory);
  assertStatus(nextStatus);
  const nextDescription = input.description === undefined ? existing.description : input.description.trim();
  const nextSolution = input.solution === undefined ? existing.solution : input.solution.trim();
  const nextSupportAgentId = normalizeSupportAgentId(
    nextCategory,
    input.supportAgentId === undefined ? existing.support_agent_id : input.supportAgentId,
  );
  const nextTagIds = input.tagIds === undefined ? undefined : normalizeTaskTagIds(input.tagIds);
  const now = new Date().toISOString();
  const completedAt = nextStatus === "done"
    ? input.completedAt?.trim()
      ? normalizeCompletedAt(input.completedAt)
      : existing.completed_at ?? now
    : null;

  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE tasks
         SET title = ?, category = ?, status = ?, description = ?, solution = ?, support_agent_id = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        nextCategory,
        nextStatus,
        nextDescription,
        nextSolution,
        nextSupportAgentId,
        now,
        completedAt,
        id,
      );
    if (nextTagIds) {
      replaceTaskTags(id, nextTagIds);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getTask(id);
}

export function addTaskLinkRecord(taskId: string, input: CreateTaskLinkInput): TaskLink {
  getTaskRow(taskId);
  const url = normalizeUrl(input.url);
  const id = randomUUID();
  const title = input.title?.trim() || null;
  getDatabase()
    .prepare("INSERT INTO task_links (id, task_id, url, title) VALUES (?, ?, ?, ?)")
    .run(id, taskId, url, title);
  return { id, url, title };
}

export function insertTaskImage(input: {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}): TaskImage {
  getTaskRow(input.taskId);
  getDatabase()
    .prepare(
      `INSERT INTO task_images
        (id, task_id, file_name, mime_type, size_bytes, storage_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.taskId, input.fileName, input.mimeType, input.sizeBytes, input.storagePath);
  return mapImage({
    id: input.id,
    file_name: input.fileName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    storage_path: input.storagePath,
  });
}

export function getStoredImage(id: string): StoredImage {
  const row = getDatabase()
    .prepare("SELECT * FROM task_images WHERE id = ?")
    .get(id) as StoredImage | undefined;
  if (!row) {
    throw new Error("图片不存在");
  }
  return row;
}

export function deleteTaskImageRecord(id: string): string {
  const image = getStoredImage(id);
  getDatabase().prepare("DELETE FROM task_images WHERE id = ?").run(id);
  return image.storage_path;
}

export function deleteTaskRecords(taskIds: string[]): { deletedCount: number; storagePaths: string[] } {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    throw new Error("请选择要删除的任务");
  }
  const ids = [...new Set(taskIds.map((id) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("任务 ID 无效");
    }
    return id.trim();
  }))];
  const database = getDatabase();
  const selectImages = database.prepare("SELECT storage_path FROM task_images WHERE task_id = ?");
  const deleteTask = database.prepare("DELETE FROM tasks WHERE id = ?");
  const storagePaths: string[] = [];
  let deletedCount = 0;

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const id of ids) {
      const imageRows = selectImages.all(id) as Array<{ storage_path: string }>;
      const result = deleteTask.run(id);
      if (Number(result.changes) > 0) {
        storagePaths.push(...imageRows.map((image) => image.storage_path));
        deletedCount += Number(result.changes);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { deletedCount, storagePaths };
}
