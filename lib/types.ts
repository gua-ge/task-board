export const TASK_CATEGORIES = ["requirement", "bug", "support"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TAG_COLORS = ["gray", "blue", "green", "amber", "red", "teal"] as const;
export type TaskTagColor = (typeof TASK_TAG_COLORS)[number];

export type BoardView = "open" | "completed";

export const COMPLETED_TASK_FILTER_PRESETS = ["week", "month", "all", "custom"] as const;
export type CompletedTaskFilterPreset = (typeof COMPLETED_TASK_FILTER_PRESETS)[number];

export type CompletedTaskFilter = {
  preset: CompletedTaskFilterPreset;
  from?: string;
  to?: string;
};

export type TaskLink = {
  id: string;
  url: string;
  title: string | null;
};

export type TaskImage = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export type SupportAgent = {
  id: string;
  name: string;
  createdAt: string;
};

export type TaskTag = {
  id: string;
  name: string;
  color: TaskTagColor;
  createdAt: string;
};

export type Task = {
  id: string;
  title: string;
  category: TaskCategory;
  status: TaskStatus;
  description: string;
  solution: string;
  supportAgent: SupportAgent | null;
  tags: TaskTag[];
  links: TaskLink[];
  images: TaskImage[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskGroup = {
  category: TaskCategory;
  label: string;
  description: string;
  tasks: Task[];
};

export type CreateTaskInput = {
  title: string;
  category: TaskCategory;
  status?: TaskStatus;
  description?: string;
  solution?: string;
  supportAgentId?: string | null;
  tagIds?: string[];
};

export type UpdateTaskInput = Partial<Pick<Task, "title" | "category" | "status" | "description" | "solution">> & {
  completedAt?: string | null;
  supportAgentId?: string | null;
  tagIds?: string[];
};

export type CreateTaskLinkInput = {
  url: string;
  title?: string | null;
};

export type CreateSupportAgentInput = {
  name: string;
};

export type CreateTaskTagInput = {
  name: string;
  color: TaskTagColor;
};

export type UpdateTaskTagInput = CreateTaskTagInput;

export type DeleteTasksResult = {
  deletedCount: number;
  failedImageCount: number;
};

export const CATEGORY_META: Record<
  TaskCategory,
  { label: string; description: string; surface: string }
> = {
  requirement: {
    label: "需求",
    description: "要做的新能力与改进",
    surface: "light",
  },
  bug: {
    label: "BUG",
    description: "需要定位与修复的问题",
    surface: "dark",
  },
  support: {
    label: "客服",
    description: "来自客户与业务现场的事项",
    surface: "pearl",
  },
};

export const STATUS_META: Record<TaskStatus, { label: string }> = {
  todo: { label: "待处理" },
  in_progress: { label: "进行中" },
  done: { label: "已完成" },
  blocked: { label: "停滞" },
};
