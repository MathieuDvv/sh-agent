import {runAgent} from "./agent.js";
import {loadConfig, saveConfig} from "./config.js";
import {appendHistory, getHistoryPath, readHistory} from "./history.js";
import {clearCachedModels, getModelCachePath, readCachedModels, writeCachedModels} from "./model-cache.js";
import {
  ensureCustomPersonalityFile,
  getCustomPersonalityPath,
  getPersonalityOption,
  openCustomPersonalityFile,
  personalityOptions
} from "./personality.js";
import {findModel, getBalance, listProviderModels, providers} from "./providers.js";
import type {AccentColor, AppConfig, Mode, ProviderId, UiConfig} from "./types.js";
import {choose, confirmToolCall, createQuietSpinner, customizeSettings, printBox, promptSecret} from "./ui.js";

export async function runAsk(prompt: string): Promise<void> {
  await runAgentCommand("ask", prompt);
}

export async function runAct(prompt: string): Promise<void> {
  await runAgentCommand("act", prompt);
}

export async function runProviderPicker(): Promise<void> {
  const config = await loadConfig();
  const selected = await choose(
    `Current provider: ${providers[config.provider].label}`,
    Object.values(providers).map((provider) => ({
      label: provider.label,
      description: providerDescription(provider.id),
      value: provider.id
    })),
    config.ui
  );

  const provider = providers[selected];
  const modelStillValid = provider.models.some((model) => model.id === config.model);
  await saveConfig({
    ...config,
    provider: selected,
    model: modelStillValid ? config.model : provider.models[0]?.id ?? config.model
  });

  await ensureProviderApiKey(selected);
  printBox("provider", `Current provider: ${provider.label}`, config.ui);
}

export async function runModelPicker(args: string[] = []): Promise<void> {
  const config = await loadConfig();
  const providerId = activeProviderId(config);
  const provider = providers[providerId];
  const apiKey = await ensureProviderApiKey(providerId);
  const refresh = args.includes("refresh") || args.includes("--refresh");
  if (refresh) {
    await clearCachedModels(providerId);
  }
  const cachedModels = refresh ? undefined : await readCachedModels(providerId);
  const models = cachedModels ?? await listProviderModels(provider, apiKey);
  if (!cachedModels) {
    await writeCachedModels(providerId, models);
  }
  const selected = await choose(
    `Current model: ${provider.label} / ${config.model}${cachedModels ? " (cached)" : ""}`,
    models.map((model) => ({
      label: model.id,
      description: model.description,
      value: model
    })),
    config.ui
  );

  await saveConfig({
    ...config,
    provider: selected.provider,
    model: selected.id
  });

  printBox("model", `Current model: ${providers[selected.provider].label} / ${selected.id}`, config.ui);
}

export async function runHistory(): Promise<void> {
  const config = await loadConfig();
  const entries = (await readHistory()).slice(0, 12);

  if (!entries.length) {
    printBox("history", `No ask/act sessions yet.\n${getHistoryPath()}`, config.ui);
    return;
  }

  const body = entries
    .map((entry) => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      return [
        `${timestamp}  ${entry.mode}  ${entry.model}`,
        `prompt: ${entry.prompt}`,
        `answer: ${oneLine(entry.answer)}`
      ].join("\n");
    })
    .join("\n\n");

  printBox("history", `${body}\n\nStored at ${getHistoryPath()}`, config.ui);
}

export async function runUsage(): Promise<void> {
  const config = await loadConfig();
  const provider = providers[activeProviderId(config)];
  const apiKey = await ensureProviderApiKey(provider.id);
  const loader = createQuietSpinner(`Checking ${provider.label} usage`, config.ui);

  try {
    const usage = await getBalance(provider, apiKey);
    loader.stop();
    printBox("usage", usage, config.ui);
  } catch (error) {
    loader.fail("usage failed");
    printBox("error", error instanceof Error ? error.message : String(error), config.ui);
  }
}

export async function runPersonalityPicker(args: string[] = []): Promise<void> {
  const config = await loadConfig();

  if (args.includes("edit") || args.includes("--edit")) {
    const opened = await openCustomPersonalityFile();
    const path = getCustomPersonalityPath();
    printBox(
      "personality",
      opened === "opened"
        ? `Edited custom personality.\n${path}`
        : `Could not open custom personality.\n${openFileCommand(path)}`,
      config.ui
    );
    return;
  }

  const selected = await choose(
    `Current personality: ${getPersonalityOption(config.personality).label}`,
    orderedPersonalityOptions(config.personality).map((option) => ({
      label: option.label,
      description: option.description,
      value: option.id
    })),
    config.ui
  );

  await saveConfig({
    ...config,
    personality: selected
  });

  if (selected === "custom") {
    const path = await ensureCustomPersonalityFile();
    const editor = process.env.VISUAL || process.env.EDITOR || "$EDITOR";
    printBox(
      "personality",
      `Current personality: Custom\nCustom file: ${path}\nEdit it with: ${editor === "$EDITOR" ? openFileCommand(path) : `${editor} ${path}`}\nOr run: -personality edit`,
      config.ui
    );
    return;
  }

  printBox("personality", `Current personality: ${getPersonalityOption(selected).label}`, config.ui);
}

export async function runCustom(): Promise<void> {
  const config = await loadConfig();
  const draft: UiConfig = {...config.ui};
  const colors: AccentColor[] = ["yellow", "cyan", "green", "magenta", "blue", "white"];

  await customizeSettings(
    "custom",
    [
      {
        label: "Accent color",
        description: "box rails, spinner, selected rows",
        valueLabel: () => draft.accentColor,
        cycle: () => {
          draft.accentColor = nextValue(colors, draft.accentColor);
        }
      },
      {
        label: "Model in title",
        description: "show model next to answer title",
        valueLabel: () => onOff(draft.showModelInTitle),
        cycle: () => {
          draft.showModelInTitle = !draft.showModelInTitle;
        }
      },
      {
        label: "Dim inactive rows",
        description: "grey unselected selector choices",
        valueLabel: () => onOff(draft.dimSelectorItems),
        cycle: () => {
          draft.dimSelectorItems = !draft.dimSelectorItems;
        }
      },
      {
        label: "Compact boxes",
        description: "keep result boxes narrow",
        valueLabel: () => onOff(draft.compactBoxes),
        cycle: () => {
          draft.compactBoxes = !draft.compactBoxes;
        }
      },
      {
        label: "Tool trace",
        description: "show called tools under spinner",
        valueLabel: () => onOff(draft.showToolTrace),
        cycle: () => {
          draft.showToolTrace = !draft.showToolTrace;
        }
      },
      {
        label: "Confirm edits",
        description: "enter allows changes, esc stops agent",
        valueLabel: () => onOff(draft.confirmBeforeModify),
        cycle: () => {
          draft.confirmBeforeModify = !draft.confirmBeforeModify;
        }
      }
    ],
    draft
  );

  await saveConfig({...config, ui: draft});
  printBox("custom", "Saved UI preferences.", draft);
}

async function runAgentCommand(mode: Mode, prompt: string): Promise<void> {
  if (!prompt.trim()) {
    const config = await loadConfig();
    printBox(mode, `Missing prompt. Example: -${mode} "Explain this folder"`, config.ui);
    return;
  }

  const config = await loadConfig();
  await ensureProviderApiKey(activeProviderId(config));

  const loader = createQuietSpinner(mode === "ask" ? "Looking around" : "Starting work", config.ui);

  try {
    const answer = await runAgent(mode, prompt, (event) => {
      if (event.type === "tool") {
        loader.addTool({name: event.name, detail: event.detail});
      } else {
        loader.setText(event.text);
      }
    }, async (tool) => {
      loader.pause();
      const approved = await confirmToolCall(tool, config.ui);
      loader.resume();
      return approved;
    });
    loader.stop();
    await appendHistory({
      timestamp: new Date().toISOString(),
      mode,
      prompt,
      answer,
      model: modelSubtitleValue(config)
    });
    printBox(mode === "ask" ? "answer" : "done", answer, config.ui, modelSubtitle(config));
  } catch (error) {
    loader.fail(`${mode} failed`);
    printBox("error", error instanceof Error ? error.message : String(error), config.ui);
  }
}

async function ensureProviderApiKey(providerId: ProviderId): Promise<string> {
  const config = await loadConfig();
  const provider = providers[providerId];
  const envValue = process.env[provider.apiKeyEnv]?.trim();

  if (envValue) {
    return envValue;
  }

  const savedValue = config.apiKeys?.[providerId]?.trim();
  if (savedValue) {
    return savedValue;
  }

  printBox(
    "api key",
    `${provider.label} needs an API key. You can set ${provider.apiKeyEnv}, or enter it once here and sh-agent will save it locally.`,
    config.ui
  );

  const apiKey = await promptSecret(`${provider.apiKeyEnv}: `);
  if (!apiKey) {
    throw new Error(`Missing ${provider.apiKeyEnv}.`);
  }

  await saveConfig({
    ...config,
    apiKeys: {
      ...config.apiKeys,
      [providerId]: apiKey
    }
  });

  return apiKey;
}

function activeProviderId(config: AppConfig): ProviderId {
  const model = findModel(config.model);
  return model?.provider ?? config.provider;
}

function orderedPersonalityOptions(current: AppConfig["personality"]): typeof personalityOptions {
  const active = personalityOptions.find((option) => option.id === current);
  if (!active) {
    return personalityOptions;
  }

  return [
    active,
    ...personalityOptions.filter((option) => option.id !== current)
  ];
}

function modelSubtitle(config: AppConfig): string | undefined {
  if (!config.ui.showModelInTitle) {
    return undefined;
  }

  return modelSubtitleValue(config);
}

function modelSubtitleValue(config: AppConfig): string {
  const providerId = activeProviderId(config);
  return `${providers[providerId].label}/${config.model}`;
}

function nextValue<T>(values: T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0] as T;
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function openFileCommand(path: string): string {
  if (process.platform === "darwin") {
    return `open ${path}`;
  }

  if (process.platform === "win32") {
    return `start ${path}`;
  }

  return `xdg-open ${path}`;
}

function providerDescription(providerId: ProviderId): string {
  switch (providerId) {
    case "deepseek":
      return "cheap default for testing";
    case "openai":
      return "premium fallback";
    case "google":
      return "Gemini models";
    case "anthropic":
      return "Claude models";
    case "nvidia":
      return "NIM model catalog";
  }
}

function oneLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

export function modelCacheInfo(): string {
  return getModelCachePath();
}
