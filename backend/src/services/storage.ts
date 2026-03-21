import { writeFile, mkdir, unlink } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
const API_BASE   = process.env.API_BASE_URL ?? "http://localhost:3000";
const MAX_MB     = Number(process.env.MAX_FILE_SIZE_MB ?? 50);

export const MAX_FILE_SIZE_BYTES = MAX_MB * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function saveFile(
  buffer: Buffer,
  originalName: string,
): Promise<{
  filePath: string;
  fileUrl:  string;
  fileType: string;
  fileSize: number;
}> {
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum allowed size of ${MAX_MB} MB`);
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const ext      = extname(originalName).toLowerCase().replace(".", "");
  const fileName = `${randomUUID()}.${ext || "bin"}`;
  const filePath = join(UPLOAD_DIR, fileName);

  await writeFile(filePath, buffer);

  return {
    filePath,
    fileUrl:  `${API_BASE}/uploads/${fileName}`,
    fileType: ext,
    fileSize: buffer.byteLength,
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // File already deleted or never existed — not a fatal error
  }
}
