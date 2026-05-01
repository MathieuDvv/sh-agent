import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {ModelRef, ProviderId} from "./types.js";

type ProviderCache = {
  timestamp: string;
  models: ModelRef[];
};

type ModelCache = Partial<Record<ProviderId, ProviderCache>>;

const cachePath = join(tmpdir(), "sh-agent-model-cache.json");
const maxAgeMs = 10 * 60 * 1000;

export async function readCachedModels(providerId: ProviderId): Promise<ModelRef[] | undefined> {
  const cache = await readCache();
  const entry = cache[providerId];

  if (!entry || Date.now() - Date.parse(entry.timestamp) > maxAgeMs) {
    return undefined;
  }

  return entry.models;
}

export async function writeCachedModels(providerId: ProviderId, models: ModelRef[]): Promise<void> {
  const cache = await readCache();
  cache[providerId] = {
    timestamp: new Date().toISOString(),
    models
  };
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export async function clearCachedModels(providerId?: ProviderId): Promise<void> {
  if (!providerId) {
    await writeFile(cachePath, "{}\n", "utf8");
    return;
  }

  const cache = await readCache();
  delete cache[providerId];
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function getModelCachePath(): string {
  return cachePath;
}

async function readCache(): Promise<ModelCache> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as ModelCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
