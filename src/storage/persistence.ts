import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export async function appendJsonl(path: string, record: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, JSON.stringify(record) + "\n", "utf-8");
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const data = await readFile(path, "utf-8");
    return data
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}
