import {chmod, mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import type {Mode} from "./types.js";

export type HistoryEntry = {
  timestamp: string;
  mode: Mode;
  prompt: string;
  answer: string;
  model: string;
};

const historyPath = join(homedir(), ".config", "sh-agent", "history.json");
const maxEntries = 100;

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const entries = await readHistory();
  entries.unshift({
    ...entry,
    prompt: truncate(entry.prompt, 1000),
    answer: truncate(entry.answer, 2000)
  });

  await mkdir(dirname(historyPath), {recursive: true});
  await writeFile(historyPath, `${JSON.stringify(entries.slice(0, maxEntries), null, 2)}\n`, "utf8");
  await chmod(historyPath, 0o600);
}

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry) : [];
  } catch {
    return [];
  }
}

export function getHistoryPath(): string {
  return historyPath;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.timestamp === "string" &&
    (entry.mode === "ask" || entry.mode === "act") &&
    typeof entry.prompt === "string" &&
    typeof entry.answer === "string" &&
    typeof entry.model === "string"
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
