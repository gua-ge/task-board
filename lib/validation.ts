import {
  COMPLETED_TASK_FILTER_PRESETS,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type TaskCategory,
  type TaskStatus,
  type CompletedTaskFilter,
} from "@/lib/types";

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export function assertCategory(value: string): asserts value is TaskCategory {
  if (!TASK_CATEGORIES.includes(value as TaskCategory)) {
    throw new Error("任务分类无效");
  }
}

export function assertStatus(value: string): asserts value is TaskStatus {
  if (!TASK_STATUSES.includes(value as TaskStatus)) {
    throw new Error("任务状态无效");
  }
}

export function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new Error("任务标题不能为空");
  }
  return title;
}

export function normalizeSupportAgentName(value: string): string {
  if (typeof value !== "string") {
    throw new Error("客服姓名无效");
  }
  const name = value.trim();
  if (!name) {
    throw new Error("客服姓名不能为空");
  }
  if (name.length > 40) {
    throw new Error("客服姓名不能超过 40 个字符");
  }
  return name;
}

export function normalizeUrl(value: string): string {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error("文档链接必须是 http 或 https 地址");
  }
}

export function normalizeCompletedAt(value: string): string {
  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime())) {
    throw new Error("完成时间无效");
  }
  if (date.getTime() > Date.now()) {
    throw new Error("完成时间不能晚于当前时间");
  }
  return date.toISOString();
}

export function normalizeCompletedTaskFilter(filter: CompletedTaskFilter): CompletedTaskFilter {
  if (!COMPLETED_TASK_FILTER_PRESETS.includes(filter.preset)) {
    throw new Error("完成时间筛选无效");
  }
  if (filter.preset !== "custom") {
    return { preset: filter.preset };
  }
  if (!filter.from || !filter.to) {
    throw new Error("自定义筛选需要起止日期");
  }
  const from = new Date(filter.from);
  const to = new Date(filter.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("自定义筛选日期无效");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("自定义筛选的开始日期必须早于结束日期");
  }
  return { preset: "custom", from: from.toISOString(), to: to.toISOString() };
}

export function assertImage(file: File): void {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error("仅支持 JPG、PNG、GIF、WebP 图片");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("图片大小不能超过 10 MB");
  }
}
