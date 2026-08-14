"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import {
  addTaskLinkRecord,
  createSupportAgentRecord,
  createTaskRecord,
  deleteTaskRecords,
  deleteTaskImageRecord,
  getTask,
  insertTaskImage,
  listSupportAgentRecords,
  listTaskGroups,
  updateTaskRecord,
} from "@/lib/db";
import { removeImage, saveImage } from "@/lib/storage";
import {
  assertImage,
  normalizeUrl,
} from "@/lib/validation";
import type {
  BoardView,
  CompletedTaskFilter,
  CreateSupportAgentInput,
  CreateTaskInput,
  CreateTaskLinkInput,
  DeleteTasksResult,
  Task,
  TaskGroup,
  TaskImage,
  TaskLink,
  SupportAgent,
  UpdateTaskInput,
} from "@/lib/types";

export async function listTasks(view: BoardView, filter?: CompletedTaskFilter): Promise<TaskGroup[]> {
  return listTaskGroups(view, filter);
}

export async function listSupportAgents(): Promise<SupportAgent[]> {
  return listSupportAgentRecords();
}

export async function createSupportAgent(input: CreateSupportAgentInput): Promise<SupportAgent> {
  const agent = createSupportAgentRecord(input);
  revalidatePath("/");
  return agent;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const task = createTaskRecord(input);
  revalidatePath("/");
  return task;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
  const task = updateTaskRecord(id, input);
  revalidatePath("/");
  return task;
}

export async function addTaskLink(taskId: string, input: CreateTaskLinkInput): Promise<TaskLink> {
  const link = addTaskLinkRecord(taskId, {
    url: normalizeUrl(input.url),
    title: input.title,
  });
  revalidatePath("/");
  return link;
}

export async function uploadTaskImage(taskId: string, file: File): Promise<TaskImage> {
  getTask(taskId);
  assertImage(file);
  const id = randomUUID();
  const storagePath = await saveImage(file, id);
  try {
    const image = insertTaskImage({
      id,
      taskId,
      fileName: file.name.trim() || `pasted-image-${id}.png`,
      mimeType: file.type,
      sizeBytes: file.size,
      storagePath,
    });
    revalidatePath("/");
    return image;
  } catch (error) {
    await removeImage(storagePath);
    throw error;
  }
}

export async function removeTaskImage(imageId: string): Promise<void> {
  const storagePath = deleteTaskImageRecord(imageId);
  await removeImage(storagePath);
  revalidatePath("/");
}

export async function deleteTasks(taskIds: string[]): Promise<DeleteTasksResult> {
  const { deletedCount, storagePaths } = deleteTaskRecords(taskIds);
  const cleanupResults = await Promise.allSettled(storagePaths.map((storagePath) => removeImage(storagePath)));
  const failedImageCount = cleanupResults.filter((result) => result.status === "rejected").length;
  revalidatePath("/");
  return { deletedCount, failedImageCount };
}
