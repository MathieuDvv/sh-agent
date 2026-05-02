import {readFile} from "node:fs/promises";
import readline from "node:readline/promises";
import {stdin, stdout} from "node:process";
import ora, {type Ora} from "ora";
import type {AccentColor, UiConfig} from "./types.js";
import type {ApprovalDecision, ToolApproval} from "./agent.js";

type SelectItem<T> = {label: string; description: string; value: T};
type StyledSegment = {text: string; style?: "accent" | "dim" | "italic" | "code"};
type StyledLine = StyledSegment[];
type ToolTraceEntry = {name: string; detail?: string};
type DiffLine = {kind: "same" | "add" | "remove" | "info"; text: string; oldLine?: number; newLine?: number};

const spinnerSentences = [
  "Reading the room",
  "Checking nearby files",
  "Building context",
  "Keeping the terminal quiet",
  "Working through the request",
  "Finding the useful bits",
  "Asking fewer questions than usual",
  "Sorting the cables",
  "Pretending this is effortless",
  "Looking for the sharp edge",
  "Checking the obvious thing first",
  "Reading before touching anything",
  "Keeping the noise down",
  "Following the breadcrumbs",
  "Turning context into an answer",
  "Avoiding a dramatic monologue",
  "Making the terminal earn its rent",
  "Checking the map twice",
  "Doing the small useful thing"
];

const accentRgb: Record<AccentColor, [number, number, number]> = {
  yellow: [242, 187, 5],
  cyan: [55, 190, 220],
  green: [67, 190, 120],
  magenta: [210, 115, 210],
  blue: [90, 145, 255],
  white: [245, 245, 245]
};

export type QuietLoader = {
  spinner: Ora;
  setText: (text: string) => void;
  addTool: (entry: ToolTraceEntry) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  fail: (text: string) => void;
};

export function createQuietSpinner(initialText: string, ui: UiConfig): QuietLoader {
  let currentText = initialText;
  const tools: ToolTraceEntry[] = [];
  const spinner = ora({
    text: loaderText(currentText, tools, ui),
    spinner: "dots",
    color: oraColor(ui.accentColor)
  }).start();

  let index = 0;
  let active = true;
  const interval = setInterval(() => {
    index = (index + 1) % spinnerSentences.length;
    setText(spinnerSentences[index] ?? initialText);
  }, 2200);

  const setText = (text: string) => {
    currentText = text;
    if (active) {
      spinner.text = loaderText(currentText, tools, ui);
    }
  };

  const addTool = (entry: ToolTraceEntry) => {
    tools.push(entry);
    if (active) {
      spinner.text = loaderText(currentText, tools, ui);
    }
  };

  const pause = () => {
    if (!active) {
      return;
    }
    active = false;
    spinner.stop();
  };

  const resume = () => {
    if (active) {
      return;
    }
    active = true;
    spinner.text = loaderText(currentText, tools, ui);
    spinner.start();
  };

  const stop = () => {
    clearInterval(interval);
    active = false;
    spinner.stop();
  };

  const fail = (text: string) => {
    clearInterval(interval);
    active = false;
    spinner.fail(text);
  };

  return {
    spinner,
    setText,
    addTool,
    pause,
    resume,
    stop,
    fail
  };
}

export function printBox(title: string, body: string, ui: UiConfig, subtitle?: string): void {
  const width = Math.min(Math.max(process.stdout.columns || 80, 48), ui.compactBoxes ? 92 : 110);
  const innerWidth = width - 4;
  const lines = renderMarkdownLines(body.trim() || "(empty)", innerWidth);
  const suffix = subtitle ? ` ${dim(`(${subtitle})`)}` : "";

  console.log(colorAccent(`╭─ ${title}`, ui.accentColor) + suffix);
  for (const line of lines) {
    console.log(line.length ? `${colorAccent("│", ui.accentColor)} ${styleLine(line, ui)}` : colorAccent("│", ui.accentColor));
  }
  console.log(colorAccent("╰─", ui.accentColor));
}

export async function choose<T>(
  title: string,
  items: Array<SelectItem<T>>,
  ui: UiConfig,
  hint = "Arrows navigate. Enter selects.",
  cancelValue?: T
): Promise<T> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return chooseByNumber(title, items);
  }

  let selectedIndex = 0;
  let rendered = false;
  let renderedLineCount = 0;

  const render = () => {
    const columns = selectorColumns();
    const labelWidth = selectorLabelWidth(items.map((item) => item.label), columns);
    resetRenderBlock(rendered, renderedLineCount);

    stdout.write("\u001b[?25l");
    stdout.write(`${truncateStyled(colorAccent(title, ui.accentColor), title, columns)}\n`);

    items.forEach((item, index) => {
      const selected = index === selectedIndex;
      const marker = selected ? colorAccent("●", ui.accentColor) : " ";
      const plainLabel = truncatePlain(item.label, labelWidth).padEnd(labelWidth, " ");
      const plainDescription = truncatePlain(item.description, Math.max(0, columns - labelWidth - 4));
      const paddedLabel = plainLabel;
      const label = selected ? colorAccent(paddedLabel, ui.accentColor) : maybeDim(paddedLabel, ui.dimSelectorItems);
      const description = selected ? plainDescription : maybeDim(plainDescription, ui.dimSelectorItems);
      stdout.write(`${marker} ${label}  ${description}\n`);
    });

    stdout.write("\n");
    stdout.write(`${dim(hint)}\n`);
    renderedLineCount = items.length + 3;
    rendered = true;
  };

  return rawSelection(render, () => items[selectedIndex]?.value as T, (direction) => {
    if (direction === "up") {
      selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
    } else {
      selectedIndex = (selectedIndex + 1) % items.length;
    }
  }, undefined, () => clearRenderBlock(renderedLineCount), cancelValue === undefined ? undefined : () => cancelValue);
}

export async function customizeSettings(
  title: string,
  items: Array<{
    label: string;
    description: string;
    valueLabel: () => string;
    cycle: () => void;
  }>,
  ui: UiConfig
): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    printBox(title, "Run this command in an interactive terminal.", ui);
    return;
  }

  let selectedIndex = 0;
  let rendered = false;
  let renderedLineCount = 0;

  const render = () => {
    const columns = selectorColumns();
    const labelWidth = selectorLabelWidth(items.map((item) => item.label), columns);
    const valueWidth = Math.min(Math.max(...items.map((item) => item.valueLabel().length)), 10);
    resetRenderBlock(rendered, renderedLineCount);

    stdout.write("\u001b[?25l");
    stdout.write(`${truncateStyled(colorAccent(title, ui.accentColor), title, columns)}\n`);

    items.forEach((item, index) => {
      const selected = index === selectedIndex;
      const marker = selected ? colorAccent("●", ui.accentColor) : " ";
      const plainLabel = truncatePlain(item.label, labelWidth).padEnd(labelWidth, " ");
      const plainValue = truncatePlain(item.valueLabel(), valueWidth).padEnd(valueWidth, " ");
      const descriptionWidth = Math.max(0, columns - labelWidth - valueWidth - 7);
      const plainDescription = truncatePlain(item.description, descriptionWidth);
      const paddedLabel = plainLabel;
      const paddedValue = plainValue;
      const label = selected ? colorAccent(paddedLabel, ui.accentColor) : maybeDim(paddedLabel, ui.dimSelectorItems);
      const value = selected ? colorAccent(paddedValue, ui.accentColor) : maybeDim(paddedValue, ui.dimSelectorItems);
      const description = selected ? dim(plainDescription) : maybeDim(plainDescription, true);
      stdout.write(`${marker} ${label}: ${value}  ${description}\n`);
    });

    stdout.write("\n");
    stdout.write(`${dim("Arrows navigate. Enter cycles. Esc saves.")}\n`);
    renderedLineCount = items.length + 3;
    rendered = true;
  };

  await rawSelection(
    render,
    () => undefined,
    (direction) => {
      if (direction === "up") {
        selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
      } else {
        selectedIndex = (selectedIndex + 1) % items.length;
      }
    },
    () => {
      items[selectedIndex]?.cycle();
      render();
      return false;
    },
    () => clearRenderBlock(renderedLineCount)
  );
}

export async function promptSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = readline.createInterface({input: stdin, output: stdout});
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\u001b[?25h");
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString("utf8");

      for (const char of key) {
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value.trim());
          return;
        }

        if (char === "\u007f") {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }

        if (char >= " ") {
          value += char;
          stdout.write("*");
        }
      }
    };

    stdout.write(prompt);
    stdout.write("\u001b[?25l");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function confirmToolCall(tool: ToolApproval, ui: UiConfig): Promise<ApprovalDecision> {
  await printApprovalPreview(tool, ui);

  const items: Array<SelectItem<ApprovalDecision>> = [
    {label: "Accept", description: "allow this action", value: "once"},
    {label: "Accept all", description: "allow future edits in this act run", value: "all"},
    {label: "Nope", description: "stop the agent", value: "no"}
  ];

  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = readline.createInterface({input: stdin, output: stdout});
    try {
      const answer = (await rl.question("Allow? [y/N] ")).trim().toLowerCase();
      return answer === "y" || answer === "yes" ? "once" : "no";
    } finally {
      rl.close();
    }
  }

  return choose("confirm", items, ui, "Arrows navigate. Enter selects. Esc stops.", "no");
}

async function printApprovalPreview(tool: ToolApproval, ui: UiConfig): Promise<void> {
  const lines = await approvalDiff(tool);
  const title = `${tool.name}${tool.detail ? ` ${tool.detail}` : ""}`;
  const lineNumberWidth = diffLineNumberWidth(lines);

  console.log(colorAccent(`╭─ ${truncatePlain(title, selectorColumns() - 4)}`, ui.accentColor));
  for (const line of lines.slice(0, 24)) {
    console.log(`${colorAccent("│", ui.accentColor)} ${styleDiffLine(line, lineNumberWidth)}`);
  }
  if (lines.length > 24) {
    console.log(`${colorAccent("│", ui.accentColor)} ${dim(`… ${lines.length - 24} more lines`)}`);
  }
  console.log(colorAccent("╰─", ui.accentColor));
}

async function approvalDiff(tool: ToolApproval): Promise<DiffLine[]> {
  if (tool.toolName !== "write_file") {
    return [{kind: "info", text: tool.arguments}];
  }

  try {
    const args = JSON.parse(tool.arguments) as {path?: string; content?: string};
    if (!args.path || typeof args.content !== "string") {
      return [{kind: "info", text: tool.arguments}];
    }
    const before = await readFile(args.path, "utf8").catch(() => "");
    return simpleDiff(before, args.content);
  } catch {
    return [{kind: "info", text: tool.arguments}];
  }
}

function simpleDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const prefixLength = commonPrefixLength(beforeLines, afterLines);
  const suffixLength = commonSuffixLength(beforeLines, afterLines, prefixLength);
  const beforeChanged = beforeLines.slice(prefixLength, beforeLines.length - suffixLength);
  const afterChanged = afterLines.slice(prefixLength, afterLines.length - suffixLength);
  const contextBeforeStart = Math.max(0, prefixLength - 3);
  const contextBefore = beforeLines.slice(contextBeforeStart, prefixLength);
  const oldContextAfterStart = beforeLines.length - suffixLength;
  const newContextAfterStart = afterLines.length - suffixLength;
  const contextAfter = beforeLines.slice(oldContextAfterStart, oldContextAfterStart + 3);

  return [
    ...contextBefore.map((line, index) => ({
      kind: "same" as const,
      text: line,
      oldLine: contextBeforeStart + index + 1,
      newLine: contextBeforeStart + index + 1
    })),
    ...beforeChanged.map((line, index) => ({
      kind: "remove" as const,
      text: line,
      oldLine: prefixLength + index + 1
    })),
    ...afterChanged.map((line, index) => ({
      kind: "add" as const,
      text: line,
      newLine: prefixLength + index + 1
    })),
    ...contextAfter.map((line, index) => ({
      kind: "same" as const,
      text: line,
      oldLine: oldContextAfterStart + index + 1,
      newLine: newContextAfterStart + index + 1
    }))
  ];
}

function commonPrefixLength(a: string[], b: string[]): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(a: string[], b: string[], prefixLength: number): number {
  let count = 0;
  while (
    count < a.length - prefixLength &&
    count < b.length - prefixLength &&
    a[a.length - count - 1] === b[b.length - count - 1]
  ) {
    count += 1;
  }
  return count;
}

function styleDiffLine(line: DiffLine, lineNumberWidth: number): string {
  const prefix = diffLinePrefix(line, lineNumberWidth);
  const text = truncatePlain(line.text, selectorColumns() - 4 - visibleLength(prefix));
  const rendered = `${prefix}${text}`;
  if (line.kind === "add") {
    return `\u001b[32m${rendered}\u001b[0m`;
  }
  if (line.kind === "remove") {
    return `\u001b[31m${rendered}\u001b[0m`;
  }
  if (line.kind === "info") {
    return dim(text);
  }
  return `${dim(prefix)}${text}`;
}

function diffLinePrefix(line: DiffLine, width: number): string {
  const oldLine = line.oldLine === undefined ? "".padStart(width, " ") : String(line.oldLine).padStart(width, " ");
  const newLine = line.newLine === undefined ? "".padStart(width, " ") : String(line.newLine).padStart(width, " ");
  const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  return `${oldLine} ${newLine} ${marker} `;
}

function diffLineNumberWidth(lines: DiffLine[]): number {
  const largest = lines.reduce((max, line) => Math.max(max, line.oldLine ?? 0, line.newLine ?? 0), 0);
  return Math.max(1, String(largest).length);
}

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

export function printHelp(ui: UiConfig): void {
  printBox(
    "sh-agent",
    [
      "Usage:",
      "  -ask Where are my Arduino files?",
      "  -act Create a quick website in ./site",
      "  -model",
      "  -provider",
      "  -personality",
      "  -usage",
      "  -custom",
      "  -history",
      "  -help",
      "  -update",
      "",
      "You can also run:",
      "  sh-agent ask Explain this repo",
      "  sh-agent act Make a small change",
      "  -model refresh",
      "  -personality edit"
    ].join("\n"),
    ui
  );
}

function rawSelection<T>(
  render: () => void,
  value: () => T,
  move: (direction: "up" | "down") => void,
  onEnter?: () => boolean,
  clear?: () => void,
  cancelValue?: () => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }
      stdin.pause();
      stdout.write("\u001b[?25h");
    };

    const finish = (result: T) => {
      clear?.();
      cleanup();
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      let index = 0;

      while (index < key.length) {
        const char = key[index];
        const sequence = key.slice(index, index + 3);

        if (char === "\u0003") {
          finish(cancelValue ? cancelValue() : value());
          return;
        }

        if (char === "\u001b" && key[index + 1] !== "[") {
          finish(cancelValue ? cancelValue() : value());
          return;
        }

        if (char === "\r" || char === "\n") {
          if (onEnter && !onEnter()) {
            index += 1;
            continue;
          }
          finish(value());
          return;
        }

        if (sequence === "\u001b[A") {
          move("up");
          render();
          index += 3;
          continue;
        }

        if (sequence === "\u001b[B") {
          move("down");
          render();
          index += 3;
          continue;
        }

        index += 1;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    render();
  });
}

function resetRenderBlock(rendered: boolean, lineCount: number): void {
  if (rendered && lineCount > 0) {
    stdout.write(`\u001b[${lineCount}A`);
  }

  stdout.write("\u001b[J");
}

function clearRenderBlock(lineCount: number): void {
  if (lineCount > 0) {
    stdout.write(`\u001b[${lineCount}A`);
  }
  stdout.write("\u001b[J");
}

function selectorColumns(): number {
  return Math.max(32, (stdout.columns || 80) - 1);
}

function selectorLabelWidth(labels: string[], columns: number): number {
  const longest = Math.max(...labels.map((label) => label.length), 0);
  const maximum = Math.max(12, Math.floor(columns * 0.55));
  return Math.min(longest, maximum);
}

function truncatePlain(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength === 1) {
    return "…";
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function truncateStyled(styled: string, plain: string, maxLength: number): string {
  if (plain.length <= maxLength) {
    return styled;
  }

  return truncatePlain(plain, maxLength);
}

async function chooseByNumber<T>(title: string, items: Array<SelectItem<T>>): Promise<T> {
  console.log(`\n${title}`);
  items.forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} - ${item.description}`);
  });

  const rl = readline.createInterface({input: stdin, output: stdout});
  try {
    while (true) {
      const answer = await rl.question("\nChoose: ");
      const index = Number.parseInt(answer.trim(), 10) - 1;
      if (items[index]) {
        return items[index].value;
      }
      console.log("Enter one of the listed numbers.");
    }
  } finally {
    rl.close();
  }
}

function colorAccent(value: string, accent: AccentColor): string {
  const [red, green, blue] = accentRgb[accent];
  return `\u001b[38;2;${red};${green};${blue}m${value}\u001b[0m`;
}

function dim(value: string): string {
  return `\u001b[2m${value}\u001b[0m`;
}

function maybeDim(value: string, shouldDim: boolean): string {
  return shouldDim ? dim(value) : value;
}

function loaderText(text: string, tools: ToolTraceEntry[], ui: UiConfig): string {
  if (!ui.showToolTrace || !tools.length) {
    return text;
  }

  const trace = tools.map((tool, index) => {
    const prefix = index === tools.length - 1 ? "╰" : "│";
    const line = `${prefix} ${tool.name}${tool.detail ? ` ${tool.detail}` : ""}`;
    return dim(truncatePlain(line, selectorColumns()));
  });

  return [text, ...trace].join("\n");
}

function oraColor(accent: AccentColor): Ora["color"] {
  if (accent === "yellow") {
    return "yellow";
  }

  if (accent === "magenta") {
    return "magenta";
  }

  if (accent === "blue") {
    return "blue";
  }

  if (accent === "green") {
    return "green";
  }

  if (accent === "white") {
    return "white";
  }

  return "cyan";
}

function renderMarkdownLines(text: string, width: number): StyledLine[] {
  const wrapped: StyledLine[] = [];

  for (const rawLine of text.split("\n")) {
    const parsed = parseMarkdownLine(rawLine);
    const lineLength = styledLength(parsed);

    if (lineLength === 0) {
      wrapped.push([]);
      continue;
    }

    wrapped.push(...wrapStyledLine(parsed, width));
  }

  return wrapped;
}

function parseMarkdownLine(rawLine: string): StyledLine {
  const trimmed = rawLine.trim();

  if (!trimmed) {
    return [];
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return parseInline(trimmed.replace(/^#{1,6}\s+/, ""), "accent");
  }

  if (trimmed.startsWith(">")) {
    const quote = trimmed.replace(/^>\s?/, "");
    return [{text: "❯ ", style: "accent"}, ...parseInline(quote, "italic")];
  }

  const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
  if (bulletMatch) {
    return [{text: "• ", style: "accent"}, ...parseInline(bulletMatch[1] ?? "")];
  }

  const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
  if (numberedMatch) {
    return [{text: `${numberedMatch[1]}. `, style: "accent"}, ...parseInline(numberedMatch[2] ?? "")];
  }

  return parseInline(trimmed);
}

function parseInline(text: string, baseStyle?: StyledSegment["style"]): StyledLine {
  const segments: StyledLine = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({text: text.slice(lastIndex, match.index), style: baseStyle});
    }

    const token = match[0];
    if (token.startsWith("`")) {
      segments.push({text: token.slice(1, -1), style: "code"});
    } else if (token.startsWith("**") || token.startsWith("__")) {
      segments.push({text: token.slice(2, -2), style: "accent"});
    } else {
      segments.push({text: token.slice(1, -1), style: "italic"});
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({text: text.slice(lastIndex), style: baseStyle});
  }

  return segments;
}

function wrapStyledLine(line: StyledLine, width: number): StyledLine[] {
  const output: StyledLine[] = [];
  let current: StyledLine = [];
  let currentLength = 0;

  for (const segment of splitSegments(line)) {
    const length = segment.text.length;

    if (segment.text === " " && currentLength === 0) {
      continue;
    }

    if (currentLength + length > width && currentLength > 0) {
      output.push(trimStyledLine(current));
      current = [];
      currentLength = 0;
      if (segment.text === " ") {
        continue;
      }
    }

    if (length > width) {
      for (let index = 0; index < segment.text.length; index += width) {
        if (currentLength > 0) {
          output.push(trimStyledLine(current));
          current = [];
          currentLength = 0;
        }
        output.push([{...segment, text: segment.text.slice(index, index + width)}]);
      }
      continue;
    }

    current.push(segment);
    currentLength += length;
  }

  if (currentLength > 0) {
    output.push(trimStyledLine(current));
  }

  return output;
}

function splitSegments(line: StyledLine): StyledLine {
  const result: StyledLine = [];

  for (const segment of line) {
    const parts = segment.text.match(/\S+|\s+/g) ?? [];
    for (const part of parts) {
      result.push({...segment, text: part});
    }
  }

  return result;
}

function trimStyledLine(line: StyledLine): StyledLine {
  const trimmed = [...line];

  while (trimmed.length && /^\s+$/.test(trimmed[trimmed.length - 1]?.text ?? "")) {
    trimmed.pop();
  }

  return trimmed;
}

function styledLength(line: StyledLine): number {
  return line.reduce((length, segment) => length + segment.text.length, 0);
}

function styleLine(line: StyledLine, ui: UiConfig): string {
  return line.map((segment) => styleSegment(segment, ui)).join("");
}

function styleSegment(segment: StyledSegment, ui: UiConfig): string {
  switch (segment.style) {
    case "accent":
      return colorAccent(segment.text, ui.accentColor);
    case "dim":
      return dim(segment.text);
    case "italic":
      return italic(segment.text);
    case "code":
      return dim(italic(segment.text));
    default:
      return segment.text;
  }
}

function italic(value: string): string {
  return `\u001b[3m${value}\u001b[0m`;
}
