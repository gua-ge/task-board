import { readFile } from "node:fs/promises";
import { getStoredImage } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const image = getStoredImage(id);
    const bytes = await readFile(image.storage_path);
    return new Response(bytes, {
      headers: {
        "Content-Type": image.mime_type,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("图片不存在", { status: 404 });
  }
}
