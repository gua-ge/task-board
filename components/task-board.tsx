"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addTaskLink,
  createSupportAgent,
  createTask,
  listTasks,
  removeTaskImage,
  updateTask,
  uploadTaskImage,
} from "@/app/actions";
import {
  CATEGORY_META,
  COMPLETED_TASK_FILTER_PRESETS,
  STATUS_META,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type BoardView,
  type CompletedTaskFilter,
  type CompletedTaskFilterPreset,
  type SupportAgent,
  type Task,
  type TaskCategory,
  type TaskGroup,
  type TaskImage,
  type TaskStatus,
} from "@/lib/types";

type TaskBoardProps = {
  initialGroups: TaskGroup[];
  initialSupportAgents: SupportAgent[];
};

type DrawerProps = {
  task: Task | null;
  defaultCategory: TaskCategory;
  supportAgents: SupportAgent[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSaved: (task: Task) => Promise<void>;
  onSupportAgentCreated: (agent: SupportAgent) => void;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function createCustomFilter(from: string, to: string): CompletedTaskFilter | null {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || start.getTime() > end.getTime()) {
    return null;
  }
  end.setDate(end.getDate() + 1);
  return { preset: "custom", from: start.toISOString(), to: end.toISOString() };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(category: TaskCategory): string {
  return CATEGORY_META[category].label;
}

function statusLabel(status: TaskStatus): string {
  return STATUS_META[status].label;
}

function isInView(view: BoardView, status: TaskStatus): boolean {
  return view === "completed" ? status === "done" : status !== "done";
}

export default function TaskBoard({ initialGroups, initialSupportAgents }: TaskBoardProps) {
  const [view, setView] = useState<BoardView>("open");
  const [groups, setGroups] = useState(initialGroups);
  const [supportAgents, setSupportAgents] = useState(initialSupportAgents);
  const [completedFilter, setCompletedFilter] = useState<CompletedTaskFilter>({ preset: "week" });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskCategory, setNewTaskCategory] = useState<TaskCategory>("requirement");
  const [isLoading, setIsLoading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => groups.flatMap((group) => group.tasks).find((task) => task.id === selectedTaskId) ?? null,
    [groups, selectedTaskId],
  );

  const refresh = useCallback(
    async (nextView = view, nextFilter = completedFilter) => {
      setIsLoading(true);
      try {
        const nextGroups = await listTasks(nextView, nextFilter);
        setGroups(nextGroups);
        return nextGroups;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "加载任务失败");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [completedFilter, view],
  );

  function switchView(nextView: BoardView) {
    setView(nextView);
    setSelectedTaskId(null);
    void refresh(nextView, completedFilter);
  }

  function handleCompletedFilterChange(preset: CompletedTaskFilterPreset) {
    setNotice(null);
    if (preset === "custom") {
      setCompletedFilter({ preset });
      return;
    }
    const nextFilter = { preset } satisfies CompletedTaskFilter;
    setCompletedFilter(nextFilter);
    void refresh("completed", nextFilter);
  }

  function applyCustomFilter() {
    const nextFilter = createCustomFilter(customFrom, customTo);
    if (!nextFilter) {
      setNotice("请选择有效的完成日期范围");
      return;
    }
    setCompletedFilter(nextFilter);
    setNotice(null);
    void refresh("completed", nextFilter);
  }

  function openNewTask(category: TaskCategory) {
    setNewTaskCategory(category);
    setSelectedTaskId("new");
    setNotice(null);
  }

  async function handleStatusChange(task: Task, status: TaskStatus) {
    setBusyTaskId(task.id);
    setNotice(null);
    try {
      await updateTask(task.id, { status });
      await refresh();
      if (selectedTaskId === task.id && !isInView(view, status)) {
        setSelectedTaskId(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新状态失败");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleSaved(task: Task) {
    const nextGroups = await refresh();
    const isVisible = nextGroups?.some((group) => group.tasks.some((item) => item.id === task.id)) ?? false;
    setSelectedTaskId(isVisible && isInView(view, task.status) ? task.id : null);
    setNotice(null);
  }

  const visibleCount = groups.reduce((total, group) => total + group.tasks.length, 0);

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="masthead-brand">
          <span className="brand-mark" aria-hidden="true">
            ◒
          </span>
          <strong>任务看板</strong>
        </div>
        <div className="masthead-controls" role="toolbar" aria-label="看板筛选">
          <div className="masthead-view-controls">
            <div className="segmented-control" role="tablist" aria-label="任务视图">
              <button
                className={view === "open" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={view === "open"}
                onClick={() => switchView("open")}
              >
                未完成
              </button>
              <button
                className={view === "completed" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={view === "completed"}
                onClick={() => switchView("completed")}
              >
                已完成
              </button>
            </div>
            <span className="masthead-count" aria-live="polite">
              {isLoading ? "正在更新…" : `${visibleCount} 个${view === "open" ? "未完成事项" : "已完成事项"}`}
            </span>
          </div>
          {view === "completed" ? (
            <div className="completed-filter" aria-label="完成时间筛选">
              <span>完成时间</span>
              <select
                value={completedFilter.preset}
                aria-label="完成时间范围"
                onChange={(event) => handleCompletedFilterChange(event.target.value as CompletedTaskFilterPreset)}
              >
                {COMPLETED_TASK_FILTER_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset === "week" ? "近一周" : preset === "month" ? "近一月" : preset === "all" ? "全部" : "自定义"}
                  </option>
                ))}
              </select>
              {completedFilter.preset === "custom" ? (
                <>
                  <input
                    type="date"
                    value={customFrom}
                    aria-label="完成时间开始日期"
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                  <span aria-hidden="true">至</span>
                  <input
                    type="date"
                    value={customTo}
                    aria-label="完成时间结束日期"
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                  <button type="button" onClick={applyCustomFilter} disabled={isLoading}>
                    应用
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <section className="board-grid" aria-label="任务分类看板">
        {groups.map((group) => (
          <section
            className={`category-panel category-panel--${CATEGORY_META[group.category].surface}`}
            key={group.category}
            aria-labelledby={`${group.category}-heading`}
          >
            <div className="category-heading">
              <h2 id={`${group.category}-heading`}>
                {group.label}
                <span className="category-count" aria-label={`${group.tasks.length} 个任务`}>
                  {group.tasks.length}
                </span>
              </h2>
              <button
                className="icon-button"
                type="button"
                aria-label={`在${group.label}中新建任务`}
                onClick={() => openNewTask(group.category)}
              >
                +
              </button>
            </div>

            <div className="task-list">
              {group.tasks.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-dot" aria-hidden="true" />
                  <strong>{view === "open" ? "这里很安静" : "还没有完成记录"}</strong>
                  <span>{view === "open" ? "把下一件要做的事放进来。" : "完成的任务会留在这里。"}</span>
                </div>
              ) : (
                group.tasks.map((task) => (
                  <article
                    className="task-card"
                    key={task.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTaskId(task.id);
                      }
                    }}
                    aria-label={`打开任务：${task.title}${task.supportAgent ? `，客服：${task.supportAgent.name}` : ""}`}
                  >
                    <h3 title={task.title}>{task.title}</h3>
                    <div className="task-card-info">
                      {task.supportAgent ? (
                        <span className="task-agent" title={`客服：${task.supportAgent.name}`}>
                          <span className="task-agent-prefix">客服 · </span>
                          {task.supportAgent.name}
                        </span>
                      ) : null}
                      <time dateTime={task.status === "done" && task.completedAt ? task.completedAt : task.updatedAt}>
                        {formatDate(task.status === "done" && task.completedAt ? task.completedAt : task.updatedAt)}
                      </time>
                    </div>
                    <select
                      className="card-status-select status-tone"
                      data-status={task.status}
                      value={task.status}
                      aria-label={`更改${task.title}的状态`}
                      disabled={busyTaskId === task.id}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation();
                        void handleStatusChange(task, event.target.value as TaskStatus);
                      }}
                    >
                      {TASK_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {statusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </section>

      {notice ? (
        <button className="notice" type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
          <span>{notice}</span>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}

      {selectedTaskId ? (
        <TaskDetailDrawer
          key={`${selectedTaskId}-${selectedTask?.updatedAt ?? newTaskCategory}`}
          task={selectedTaskId === "new" ? null : selectedTask}
          defaultCategory={selectedTask?.category ?? newTaskCategory}
          supportAgents={supportAgents}
          onClose={() => setSelectedTaskId(null)}
          onRefresh={async () => {
            await refresh();
          }}
          onSaved={handleSaved}
          onSupportAgentCreated={(agent) => setSupportAgents((current) => [...current, agent])}
        />
      ) : null}
    </main>
  );
}

function TaskDetailDrawer({
  task,
  defaultCategory,
  supportAgents,
  onClose,
  onRefresh,
  onSaved,
  onSupportAgentCreated,
}: DrawerProps) {
  const isNew = !task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [category, setCategory] = useState<TaskCategory>(task?.category ?? defaultCategory);
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [completedAt, setCompletedAt] = useState(task?.completedAt ? toDateTimeLocal(task.completedAt) : "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [solution, setSolution] = useState(task?.solution ?? "");
  const [supportAgentId, setSupportAgentId] = useState(task?.supportAgent?.id ?? "");
  const [newSupportAgentName, setNewSupportAgentName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [previewImage, setPreviewImage] = useState<TaskImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewImageIndex = previewImage && task
    ? task.images.findIndex((image) => image.id === previewImage.id)
    : -1;
  const canShowPreviousImage = previewImageIndex > 0;
  const canShowNextImage = Boolean(task && previewImageIndex >= 0 && previewImageIndex < task.images.length - 1);

  const closeImagePreview = useCallback(() => {
    setPreviewImage(null);
    requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImagePreview();
      }
      if (event.key === "ArrowLeft" && canShowPreviousImage && task) {
        event.preventDefault();
        setPreviewImage(task.images[previewImageIndex - 1]);
      }
      if (event.key === "ArrowRight" && canShowNextImage && task) {
        event.preventDefault();
        setPreviewImage(task.images[previewImageIndex + 1]);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canShowNextImage, canShowPreviousImage, closeImagePreview, previewImage, previewImageIndex, task]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextCompletedAt = status === "done" ? fromDateTimeLocal(completedAt) : null;
    if (task && status === "done" && !nextCompletedAt) {
      setError("请输入有效的完成时间");
      return;
    }
    startTransition(async () => {
      try {
        const saved = task
          ? await updateTask(task.id, {
              title,
              category,
              status,
              description,
              solution,
              supportAgentId: category === "requirement" ? null : supportAgentId || null,
              completedAt: nextCompletedAt,
            })
          : await createTask({
              title,
              category,
              status,
              description,
              solution,
              supportAgentId: category === "requirement" ? null : supportAgentId || null,
            });
        await onSaved(saved);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存任务失败");
      }
    });
  }

  function handleCategoryChange(nextCategory: TaskCategory) {
    setCategory(nextCategory);
    if (nextCategory === "requirement") {
      setSupportAgentId("");
    }
  }

  function handleStatusChange(nextStatus: TaskStatus) {
    setStatus(nextStatus);
    if (nextStatus === "done" && !completedAt) {
      setCompletedAt(toDateTimeLocal(new Date().toISOString()));
    }
    if (nextStatus !== "done") {
      setCompletedAt("");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (!imageItem) {
      return;
    }
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file || !task) {
      setError("请先保存任务，再粘贴图片");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await uploadTaskImage(task.id, file);
        await onRefresh();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "上传图片失败");
      }
    });
  }

  function handleAddSupportAgent() {
    setError(null);
    startTransition(async () => {
      try {
        const agent = await createSupportAgent({ name: newSupportAgentName });
        onSupportAgentCreated(agent);
        setSupportAgentId(agent.id);
        setNewSupportAgentName("");
      } catch (agentError) {
        setError(agentError instanceof Error ? agentError.message : "添加客服失败");
      }
    });
  }

  function handleAddLink() {
    if (!task) {
      setError("请先保存任务，再添加文档链接");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addTaskLink(task.id, { url: linkUrl, title: linkTitle });
        setLinkUrl("");
        setLinkTitle("");
        await onRefresh();
      } catch (linkError) {
        setError(linkError instanceof Error ? linkError.message : "添加链接失败");
      }
    });
  }

  function handleRemoveImage(imageId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeTaskImage(imageId);
        await onRefresh();
      } catch (removeError) {
        setError(removeError instanceof Error ? removeError.message : "删除图片失败");
      }
    });
  }

  return (
    <div className="drawer-layer" role="presentation">
      <button
        className="drawer-backdrop"
        type="button"
        aria-label="关闭任务详情"
        aria-hidden={previewImage ? true : undefined}
        disabled={Boolean(previewImage)}
        onClick={onClose}
      />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-heading"
        aria-hidden={previewImage ? true : undefined}
        inert={previewImage ? true : undefined}
      >
        <div className="drawer-header">
          <div>
            <span className="eyebrow eyebrow-dark">{isNew ? "NEW TASK" : "TASK DETAIL"}</span>
            <h2 id="drawer-heading">{isNew ? "记录一件新事" : "任务详情"}</h2>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <form className="drawer-form" onSubmit={handleSubmit}>
          <label className="field field-wide">
            <span>任务标题</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：补充德国站 EPR 配置"
              maxLength={160}
            />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>所属分区</span>
              <select value={category} onChange={(event) => handleCategoryChange(event.target.value as TaskCategory)}>
                {TASK_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>当前状态</span>
              <select
                className="status-tone"
                data-status={status}
                value={status}
                onChange={(event) => handleStatusChange(event.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {statusLabel(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {category !== "requirement" ? (
            <div className="field-grid support-agent-fields">
              <label className="field">
                <span>客服</span>
                <select value={supportAgentId} onChange={(event) => setSupportAgentId(event.target.value)}>
                  <option value="">未指定</option>
                  {supportAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>新增客服</span>
                <div className="inline-create-form">
                  <input
                    value={newSupportAgentName}
                    maxLength={40}
                    aria-label="新增客服姓名"
                    placeholder="输入姓名"
                    onChange={(event) => setNewSupportAgentName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (newSupportAgentName.trim() && !isPending) {
                          handleAddSupportAgent();
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddSupportAgent}
                    disabled={!newSupportAgentName.trim() || isPending}
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {task ? (
            <div className="field-grid task-time-grid">
              <div className="field">
                <span>创建时间</span>
                <time className="readonly-time" dateTime={task.createdAt}>
                  {formatDateTime(task.createdAt)}
                </time>
              </div>
              {status === "done" ? (
                <label className="field">
                  <span>完成时间</span>
                  <input
                    type="datetime-local"
                    value={completedAt}
                    max={toDateTimeLocal(new Date().toISOString())}
                    onChange={(event) => setCompletedAt(event.target.value)}
                    required
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <label className="field field-wide">
            <span>任务详情</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onPaste={handlePaste}
              placeholder={task ? "补充背景、处理记录和下一步…\n也可以直接在这里粘贴图片。" : "补充背景、处理记录和下一步…"}
              rows={7}
            />
          </label>

          <label className="field field-wide solution-field">
            <span>解决方案</span>
            <textarea
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              onPaste={handlePaste}
              placeholder={task ? "记录处理方法、操作步骤和最终结论…\n也可以直接在这里粘贴图片。" : "记录处理方法、操作步骤和最终结论…"}
              rows={6}
            />
          </label>

          {task ? (
            <>
              <section className="attachment-section" aria-labelledby="image-heading">
                <div className="section-heading">
                  <div>
                    <span className="field-caption">IMAGES</span>
                    <h3 id="image-heading">图片附件</h3>
                  </div>
                  <span className="attachment-count">{task.images.length}</span>
                </div>
                {task.images.length === 0 ? (
                  <p className="section-hint">在任务详情或解决方案中粘贴截图，图片会保存在本机。</p>
                ) : (
                  <div className="image-grid">
                    {task.images.map((image) => (
                      <figure className="image-attachment" key={image.id}>
                        <button
                          className="image-preview-trigger"
                          type="button"
                          aria-label={`查看图片${image.fileName}`}
                          onClick={(event) => {
                            previewTriggerRef.current = event.currentTarget;
                            setPreviewImage(image);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.url} alt="" />
                        </button>
                        <figcaption>
                          <span>{formatBytes(image.sizeBytes)}</span>
                          <button type="button" onClick={() => handleRemoveImage(image.id)} aria-label={`删除${image.fileName}`}>
                            删除
                          </button>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </section>

              <section className="attachment-section" aria-labelledby="link-heading">
                <div className="section-heading">
                  <div>
                    <span className="field-caption">DOCUMENT LINKS</span>
                    <h3 id="link-heading">文档链接</h3>
                  </div>
                  <span className="attachment-count">{task.links.length}</span>
                </div>
                {task.links.length > 0 ? (
                  <div className="link-list">
                    {task.links.map((link) => (
                      <a href={link.url} key={link.id} target="_blank" rel="noreferrer">
                        <span>{link.title || link.url}</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="link-form">
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://…"
                    aria-label="文档链接地址"
                  />
                  <input
                    value={linkTitle}
                    onChange={(event) => setLinkTitle(event.target.value)}
                    placeholder="链接名称（可选）"
                    aria-label="文档链接名称"
                  />
                  <button type="button" onClick={() => void handleAddLink()}>
                    添加
                  </button>
                </div>
              </section>
            </>
          ) : (
            <p className="save-hint">保存任务后，就可以在任务详情或解决方案中粘贴图片，并添加文档链接。</p>
          )}

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <div className="drawer-actions">
            <button className="secondary-pill" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-pill" type="submit" disabled={isPending}>
              {isPending ? "保存中…" : isNew ? "创建任务" : "保存更改"}
            </button>
          </div>
        </form>
      </aside>

      {previewImage ? (
        <div className="image-preview-layer" role="presentation">
          <button
            className="image-preview-backdrop"
            type="button"
            aria-label="关闭图片预览"
            onClick={closeImagePreview}
          />
          <div
            className="image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-preview-title"
          >
            <div className="image-preview-header">
              <div>
                <h3 id="image-preview-title">{previewImage.fileName}</h3>
                <span aria-live="polite">
                  {formatBytes(previewImage.sizeBytes)}
                  {task && task.images.length > 1 ? ` · ${previewImageIndex + 1} / ${task.images.length}` : ""}
                </span>
              </div>
              <button
                className="image-preview-close"
                type="button"
                onClick={closeImagePreview}
                aria-label="关闭图片预览"
                autoFocus
              >
                ×
              </button>
            </div>
            <div className={`image-preview-stage${task && task.images.length > 1 ? " image-preview-stage-multiple" : ""}`}>
              {task && task.images.length > 1 ? (
                <button
                  className="image-preview-nav image-preview-nav-previous"
                  type="button"
                  onClick={() => setPreviewImage(task.images[previewImageIndex - 1])}
                  aria-label="查看上一张图片"
                  disabled={!canShowPreviousImage}
                >
                  ‹
                </button>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="image-preview-full" src={previewImage.url} alt={previewImage.fileName} />
              {task && task.images.length > 1 ? (
                <button
                  className="image-preview-nav image-preview-nav-next"
                  type="button"
                  onClick={() => setPreviewImage(task.images[previewImageIndex + 1])}
                  aria-label="查看下一张图片"
                  disabled={!canShowNextImage}
                >
                  ›
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
