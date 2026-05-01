import {chmod, mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import type {AccentColor, AppConfig, ProviderId, UiConfig} from "./types.js";

const configPath = join(homedir(), ".config", "sh-agent", "config.json");

const defaultConfig: AppConfig = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  ui: {
    accentColor: "yellow",
    showModelInTitle: false,
    dimSelectorItems: true,
    compactBoxes: true,
    showToolTrace: false,
    confirmBeforeModify: true
  }
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      provider: isProvider(parsed.provider) ? parsed.provider : defaultConfig.provider,
      model: typeof parsed.model === "string" ? parsed.model : defaultConfig.model,
      apiKeys: sanitizeApiKeys(parsed.apiKeys),
      ui: sanitizeUi(parsed.ui)
    };
  } catch {
    return {...defaultConfig};
  }
}

export function defaultUiConfig(): UiConfig {
  return {...defaultConfig.ui};
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(dirname(configPath), {recursive: true});
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(configPath, 0o600);
}

export function getConfigPath(): string {
  return configPath;
}

function isProvider(value: unknown): value is ProviderId {
  return value === "deepseek" || value === "openai" || value === "google" || value === "anthropic" || value === "nvidia";
}

function sanitizeApiKeys(value: unknown): AppConfig["apiKeys"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Partial<Record<ProviderId, unknown>>;
  const apiKeys: Partial<Record<ProviderId, string>> = {};

  for (const provider of ["deepseek", "openai", "google", "anthropic", "nvidia"] as const) {
    if (typeof input[provider] === "string" && input[provider]?.trim()) {
      apiKeys[provider] = input[provider];
    }
  }

  return Object.keys(apiKeys).length ? apiKeys : undefined;
}

function sanitizeUi(value: unknown): UiConfig {
  if (!value || typeof value !== "object") {
    return defaultUiConfig();
  }

  const input = value as Partial<Record<keyof UiConfig, unknown>>;

  return {
    accentColor: isAccentColor(input.accentColor) ? input.accentColor : defaultConfig.ui.accentColor,
    showModelInTitle:
      typeof input.showModelInTitle === "boolean" ? input.showModelInTitle : defaultConfig.ui.showModelInTitle,
    dimSelectorItems:
      typeof input.dimSelectorItems === "boolean" ? input.dimSelectorItems : defaultConfig.ui.dimSelectorItems,
    compactBoxes: typeof input.compactBoxes === "boolean" ? input.compactBoxes : defaultConfig.ui.compactBoxes,
    showToolTrace: typeof input.showToolTrace === "boolean" ? input.showToolTrace : defaultConfig.ui.showToolTrace,
    confirmBeforeModify:
      typeof input.confirmBeforeModify === "boolean"
        ? input.confirmBeforeModify
        : defaultConfig.ui.confirmBeforeModify
  };
}

function isAccentColor(value: unknown): value is AccentColor {
  return ["yellow", "cyan", "green", "magenta", "blue", "white"].includes(String(value));
}
