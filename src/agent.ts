import {readFile, readdir} from "node:fs/promises";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {loadConfig} from "./config.js";
import {chatCompletion, findModel, providers} from "./providers.js";
import {executeTool, isMutatingTool, toolDefinitions} from "./tools.js";
import type {ChatMessage, Mode} from "./types.js";

const maxTurns = 10;
export type AgentEvent =
  | {type: "status"; text: string}
  | {type: "tool"; name: string; detail?: string};
export type ToolApproval = {name: string; detail?: string; arguments: string};

export async function runAgent(
  mode: Mode,
  prompt: string,
  onEvent: (event: AgentEvent) => void,
  confirmTool?: (tool: ToolApproval) => Promise<boolean>
): Promise<string> {
  const config = await loadConfig();
  const model = findModel(config.model);
  const provider = model ? providers[model.provider] : providers[config.provider];
  const modelId = model?.id ?? provider.models[0]?.id;

  if (!modelId) {
    throw new Error(`No model configured for ${provider.label}.`);
  }

  const tools = toolDefinitions(mode);
  const referencedContext = await loadPromptReferences(prompt);
  const messages: ChatMessage[] = [
    {role: "system", content: systemPrompt(mode)},
    {role: "user", content: referencedContext ? `${prompt}\n\nReferenced context:\n${referencedContext}` : prompt}
  ];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    onEvent({type: "status", text: turn === 0 ? "Asking the model" : "Continuing with tool results"});

    const response = await chatCompletion({
      provider,
      model: modelId,
      messages,
      tools,
      mode,
      apiKey: process.env[provider.apiKeyEnv] ?? config.apiKeys?.[provider.id] ?? ""
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("The provider returned no message.");
    }

    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      return message.content?.trim() || "Done.";
    }

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      const formattedName = formatToolName(toolCall.function.name);
      const detail = toolDetail(toolCall.function.arguments);
      if (mode === "act" && config.ui.confirmBeforeModify && isMutatingTool(toolCall.function.name)) {
        const approved = await confirmTool?.({
          name: formattedName,
          detail,
          arguments: toolCall.function.arguments
        });
        if (!approved) {
          return `Stopped before ${formattedName}${detail ? ` ${detail}` : ""}.`;
        }
      }

      onEvent({
        type: "tool",
        name: formattedName,
        detail
      });
      const result = await executeTool(toolCall.function.name, toolCall.function.arguments, mode);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.slice(0, 50000)
      });
    }
  }

  return "Stopped after reaching the tool turn limit. Try a narrower prompt.";
}

function toolDetail(rawArguments: string): string | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    const value = parsed.path ?? parsed.query ?? parsed.command ?? parsed.pattern;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemPrompt(mode: Mode): string {
  const common = [
    "You are sh-agent, a quiet terminal-native coding assistant.",
    "Keep output concise and directly useful; prefer one or two short sentences unless the task needs more.",
    "Do not narrate internal tool calls.",
    "Do not introduce yourself or explain your mode unless the user asks what you are.",
    "For simple greetings, reply with a brief greeting and ask what the user needs.",
    "When helpful, end with exact commands the user can run next.",
    "Prefer local files and the current working directory as context."
  ];

  if (mode === "ask") {
    return [
      ...common,
      "You are in ask mode. You may inspect files, but you must not modify files or run mutating commands.",
      "Answer the user in a compact final response."
    ].join("\n");
  }

  return [
    ...common,
    "You are in act mode. You may edit files, create directories, and run commands to complete the request.",
    "Avoid destructive shell commands unless the user explicitly asks for them.",
    "After changes, summarize what changed and mention any verification you ran."
  ].join("\n");
}

function formatToolName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function loadPromptReferences(prompt: string): Promise<string> {
  const matches = [...prompt.matchAll(/@([^\s]+)/g)];
  if (!matches.length) {
    return "";
  }

  const chunks: string[] = [];

  for (const match of matches.slice(0, 8)) {
    const raw = match[1]?.replace(/[.,;:)]+$/, "");
    if (!raw) {
      continue;
    }

    const path = expandPath(raw);
    try {
      const listing = await readdir(path, {withFileTypes: true});
      chunks.push([
        `@${raw} is a directory:`,
        ...listing.slice(0, 80).map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
      ].join("\n"));
      continue;
    } catch {
      // Not a readable directory, try a file below.
    }

    try {
      const content = await readFile(path, "utf8");
      chunks.push(`@${raw}:\n${content.slice(0, 30000)}`);
    } catch {
      chunks.push(`@${raw}: could not read ${path}`);
    }
  }

  return chunks.join("\n\n");
}

function expandPath(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return resolve(process.cwd(), path);
}
