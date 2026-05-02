import {chmod, mkdir, readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join} from "node:path";
import {getConfigDir} from "./config.js";
import type {PersonalityId} from "./types.js";

export type PersonalityOption = {
  id: PersonalityId;
  label: string;
  description: string;
  prompt: string;
};

export const personalityOptions: PersonalityOption[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "quiet, useful, pragmatic default",
    prompt: [
      "Use a balanced, pragmatic style.",
      "Be concise by default, but include enough context to make decisions clear.",
      "Ask a question only when a reasonable assumption would be risky."
    ].join("\n")
  },
  {
    id: "concise",
    label: "Concise",
    description: "short answers, minimal ceremony",
    prompt: [
      "Use a terse, direct style.",
      "Lead with the answer or action taken.",
      "Avoid background explanation unless it changes what the user should do."
    ].join("\n")
  },
  {
    id: "mentor",
    label: "Mentor",
    description: "explain tradeoffs and teach as you go",
    prompt: [
      "Use a clear teaching style.",
      "Explain the reasoning behind recommendations and code changes.",
      "Keep explanations practical and tied to the user's current task."
    ].join("\n")
  },
  {
    id: "engineer",
    label: "Engineer",
    description: "rigorous, test-minded, code-review aware",
    prompt: [
      "Use a senior engineering style.",
      "Prioritize correctness, maintainability, tests, and clear tradeoffs.",
      "Call out risks, edge cases, and verification gaps when they matter."
    ].join("\n")
  },
  {
    id: "planner",
    label: "Planner",
    description: "structured plans before larger work",
    prompt: [
      "Use a structured planning style for non-trivial work.",
      "Break larger tasks into concrete steps before implementing.",
      "Keep progress updates short and action-oriented."
    ].join("\n")
  },
  {
    id: "custom",
    label: "Custom",
    description: "read instructions from ~/.config/sh-agent/custom_p.md",
    prompt: ""
  }
];

const customPersonalityTemplate = [
  "# Custom sh-agent personality",
  "",
  "Write instructions that should be added to every ask/act system prompt.",
  "",
  "Examples:",
  "- Prefer short answers unless I ask for depth.",
  "- Use British English.",
  "- Be explicit about assumptions.",
  "- Suggest tests after code changes.",
  ""
].join("\n");

export function getCustomPersonalityPath(): string {
  return join(getConfigDir(), "custom_p.md");
}

export function getPersonalityOption(id: PersonalityId): PersonalityOption {
  return personalityOptions.find((option) => option.id === id) ?? (personalityOptions[0] as PersonalityOption);
}

export async function loadPersonalityPrompt(id: PersonalityId): Promise<string> {
  if (id !== "custom") {
    return getPersonalityOption(id).prompt;
  }

  try {
    return (await readFile(getCustomPersonalityPath(), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function ensureCustomPersonalityFile(): Promise<string> {
  const path = getCustomPersonalityPath();

  try {
    await readFile(path, "utf8");
  } catch {
    await mkdir(getConfigDir(), {recursive: true});
    await writeFile(path, customPersonalityTemplate, "utf8");
    await chmod(path, 0o600);
  }

  return path;
}

export async function openCustomPersonalityFile(): Promise<"opened" | "no-editor"> {
  const path = await ensureCustomPersonalityFile();
  const editor = process.env.VISUAL || process.env.EDITOR || defaultFileOpener();

  if (!editor?.trim()) {
    return "no-editor";
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [path], {
      shell: true,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${editor} exited with code ${code ?? "unknown"}.`));
    });
  });

  return "opened";
}

function defaultFileOpener(): string | undefined {
  if (process.platform === "darwin") {
    return "open";
  }

  if (process.platform === "win32") {
    return "start";
  }

  return "xdg-open";
}
