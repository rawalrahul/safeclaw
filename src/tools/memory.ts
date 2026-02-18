import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface MemoryEntry {
  value: string;
  createdAt: number;
  updatedAt: number;
}

type MemoryStore = Record<string, MemoryEntry>;

const MEMORY_FILE = "memory.json";

async function load(storageDir: string): Promise<MemoryStore> {
  try {
    const raw = await readFile(join(storageDir, MEMORY_FILE), "utf8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    return {};
  }
}

async function save(storageDir: string, store: MemoryStore): Promise<void> {
  await mkdir(storageDir, { recursive: true });
  await writeFile(join(storageDir, MEMORY_FILE), JSON.stringify(store, null, 2), "utf8");
}

export async function memoryRead(storageDir: string, key: string): Promise<string> {
  const store = await load(storageDir);
  const entry = store[key];
  if (!entry) return `No memory found for key: "${key}"`;
  return `${key}: ${entry.value}`;
}

export async function memoryWrite(storageDir: string, key: string, value: string): Promise<string> {
  const store = await load(storageDir);
  const now = Date.now();
  store[key] = {
    value,
    createdAt: store[key]?.createdAt ?? now,
    updatedAt: now,
  };
  await save(storageDir, store);
  return `Remembered: ${key} = ${value}`;
}

export async function memoryList(storageDir: string): Promise<string> {
  const store = await load(storageDir);
  const keys = Object.keys(store);
  if (keys.length === 0) return "Memory is empty.";
  return keys.map((k) => `${k}: ${store[k].value}`).join("\n");
}

export async function memoryDelete(storageDir: string, key: string): Promise<string> {
  const store = await load(storageDir);
  if (!(key in store)) return `No memory found for key: "${key}"`;
  delete store[key];
  await save(storageDir, store);
  return `Deleted memory: ${key}`;
}

/**
 * Returns a formatted block of all stored memories, or null if empty.
 * Injected into the system prompt so the LLM always has context.
 */
export async function getMemoryContext(storageDir: string): Promise<string | null> {
  const store = await load(storageDir);
  const keys = Object.keys(store);
  if (keys.length === 0) return null;
  const entries = keys.map((k) => `- ${k}: ${store[k].value}`).join("\n");
  return `# Remembered Facts (from memory tool)\n\n${entries}`;
}
