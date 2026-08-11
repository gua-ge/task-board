import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDirectory = process.env.TASK_BOARD_DATA_DIR ?? path.join(process.cwd(), ".data");
export const uploadDirectory = path.join(dataDirectory, "uploads");

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function saveImage(file: File, id: string): Promise<string> {
  await mkdir(uploadDirectory, { recursive: true });
  const extension = extensionByMimeType[file.type] ?? "bin";
  const filePath = path.join(uploadDirectory, `${id}.${extension}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return filePath;
}

export async function removeImage(filePath: string): Promise<void> {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export function getDataDirectory(): string {
  return dataDirectory;
}
