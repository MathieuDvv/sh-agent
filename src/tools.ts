import {exec, execFile} from "node:child_process";
import {mkdir, readFile, readdir, stat, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {homedir} from "node:os";
import {dirname, resolve} from "node:path";
import {promisify} from "node:util";
import type {Mode, ToolDefinition} from "./types.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const openWebSearchBin = require.resolve("open-websearch/build/index.js");
const ignoredDirs = new Set([".git", "node_modules", "dist", ".next", ".turbo", "build", "coverage"]);
const readOnlyToolNames = ["list_files", "find_files", "read_file", "search_text", "search_web"];
const mutatingTools = new Set(["write_file", "make_dir", "run_shell"]);
const webSearchEngines = new Set(["startpage", "duckduckgo", "brave"]);

type WebSearchResult = {
  title: string;
  url: string;
  description: string;
  source?: string;
  engine?: string;
};

type WebSearchPayload = {
  status?: string;
  data?: {
    results?: WebSearchResult[];
    partialFailures?: Array<{engine: string; message: string}>;
  };
  error?: {
    message?: string;
  } | null;
};

export function isMutatingTool(name: string): boolean {
  return mutatingTools.has(name);
}

export function toolDefinitions(mode: Mode): ToolDefinition[] {
  const readOnly: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List files and folders at a path.",
        parameters: objectSchema({
          path: stringSchema("Path to list. Defaults to the current directory."),
          max_entries: numberSchema("Maximum entries to return. Defaults to 120.")
        })
      }
    },
    {
      type: "function",
      function: {
        name: "find_files",
        description: "Find files or folders by name pattern.",
        parameters: objectSchema({
          path: stringSchema("Directory to search. Defaults to the current directory."),
          pattern: stringSchema("Case-insensitive text to look for in file or folder names."),
          max_matches: numberSchema("Maximum matches to return. Defaults to 80.")
        }, ["pattern"])
      }
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text file.",
        parameters: objectSchema({
          path: stringSchema("File path to read."),
          max_chars: numberSchema("Maximum characters to return. Defaults to 20000.")
        }, ["path"])
      }
    },
    {
      type: "function",
      function: {
        name: "search_text",
        description: "Search text files for a query.",
        parameters: objectSchema({
          path: stringSchema("Directory or file to search. Defaults to the current directory."),
          query: stringSchema("Text or regex to search for."),
          max_matches: numberSchema("Maximum matches to return. Defaults to 80.")
        }, ["query"])
      }
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the web without an API key and return concise source results. Use for current information or external documentation.",
        parameters: objectSchema({
          query: stringSchema("Web search query."),
          max_results: numberSchema("Maximum results to return, from 1 to 10. Defaults to 5."),
          engine: stringSchema("Optional search engine: startpage, duckduckgo, or brave. Defaults to startpage.")
        }, ["query"])
      }
    }
  ];

  if (mode === "ask") {
    return readOnly;
  }

  return [
    ...readOnly,
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or overwrite a text file.",
        parameters: objectSchema({
          path: stringSchema("File path to write."),
          content: stringSchema("Complete file content.")
        }, ["path", "content"])
      }
    },
    {
      type: "function",
      function: {
        name: "make_dir",
        description: "Create a directory and parent directories if needed.",
        parameters: objectSchema({
          path: stringSchema("Directory path to create.")
        }, ["path"])
      }
    },
    {
      type: "function",
      function: {
        name: "run_shell",
        description: "Run a shell command in the current working directory.",
        parameters: objectSchema({
          command: stringSchema("Shell command to run.")
        }, ["command"])
      }
    }
  ];
}

export async function executeTool(name: string, rawArgs: string, mode: Mode): Promise<string> {
  const args = parseArgs(rawArgs);

  if (mode === "ask" && !readOnlyToolNames.includes(name)) {
    return `Tool ${name} is not available in ask mode.`;
  }

  switch (name) {
    case "list_files":
      return listFiles(args.path, args.max_entries);
    case "find_files":
      return findFiles(args.path, requiredString(args.pattern, "pattern"), args.max_matches);
    case "read_file":
      return readTextFile(requiredString(args.path, "path"), args.max_chars);
    case "search_text":
      return searchText(args.path, requiredString(args.query, "query"), args.max_matches);
    case "search_web":
      return searchWeb(requiredString(args.query, "query"), args.max_results, args.engine);
    case "write_file":
      return writeTextFile(requiredString(args.path, "path"), requiredString(args.content, "content"));
    case "make_dir":
      return makeDirectory(requiredString(args.path, "path"));
    case "run_shell":
      return runShell(requiredString(args.command, "command"));
    default:
      return `Unknown tool: ${name}`;
  }
}

async function listFiles(pathValue: unknown, maxEntriesValue: unknown): Promise<string> {
  const target = expandPath(optionalString(pathValue) ?? ".");
  const maxEntries = optionalNumber(maxEntriesValue) ?? 120;
  const targetStat = await stat(target);

  if (!targetStat.isDirectory()) {
    return `file ${target}`;
  }

  const entries = await readdir(target, {withFileTypes: true});

  return entries
    .slice(0, maxEntries)
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .join("\n") || "(empty)";
}

async function findFiles(pathValue: unknown, pattern: string, maxMatchesValue: unknown): Promise<string> {
  const target = expandPath(optionalString(pathValue) ?? ".");
  const maxMatches = optionalNumber(maxMatchesValue) ?? 80;
  const matches: string[] = [];
  const needle = pattern.toLowerCase();

  await walk(target, async (path) => {
    if (matches.length >= maxMatches) {
      return;
    }
    if (path.toLowerCase().includes(needle)) {
      matches.push(path);
    }
  });

  return matches.join("\n") || "No matching files.";
}

async function readTextFile(pathValue: string, maxCharsValue: unknown): Promise<string> {
  const maxChars = optionalNumber(maxCharsValue) ?? 20000;
  const content = await readFile(expandPath(pathValue), "utf8");
  return content.slice(0, maxChars);
}

async function searchText(pathValue: unknown, query: string, maxMatchesValue: unknown): Promise<string> {
  const target = expandPath(optionalString(pathValue) ?? ".");
  const maxMatches = optionalNumber(maxMatchesValue) ?? 80;

  try {
    const {stdout} = await execFileAsync("rg", [
      "--line-number",
      "--hidden",
      "--glob",
      "!node_modules",
      "--glob",
      "!.git",
      "--max-count",
      String(maxMatches),
      query,
      target
    ], {maxBuffer: 1024 * 1024});
    return stdout.trim() || "No matches.";
  } catch (error) {
    const maybe = error as {code?: unknown; stdout?: string};
    if (maybe.code === 1) {
      return maybe.stdout?.trim() || "No matches.";
    }
    return searchTextFallback(target, query, maxMatches);
  }
}

async function searchWeb(query: string, maxResultsValue: unknown, engineValue: unknown): Promise<string> {
  const maxResults = clamp(optionalNumber(maxResultsValue) ?? 5, 1, 10);
  const engine = webSearchEngine(engineValue);
  const payload = await runOpenWebSearch(query, maxResults, engine);
  const data = payload.status === "ok" ? payload.data : undefined;
  const results = data?.results ?? [];

  if (!results.length) {
    const failures = data?.partialFailures
      ?.map((failure) => `${failure.engine}: ${failure.message}`)
      .join("\n");
    return failures ? `No web results.\n${failures}` : "No web results.";
  }

  return uniqueWebResults(results)
    .slice(0, maxResults)
    .map((result, index) => {
      const description = cleanSnippet(result.description);
      return [
        `${index + 1}. ${cleanSnippet(result.title)}`,
        `url: ${result.url}`,
        result.source ? `source: ${cleanSnippet(result.source)}` : undefined,
        result.engine ? `engine: ${result.engine}` : undefined,
        description ? `snippet: ${description}` : undefined
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

async function runOpenWebSearch(query: string, maxResults: number, engine: string): Promise<WebSearchPayload> {
  const args = [
    openWebSearchBin,
    "search",
    query,
    "--json",
    "--limit",
    String(maxResults),
    "--engines",
    engine
  ];

  try {
    const {stdout} = await execFileAsync(process.execPath, args, {
      env: {
        ...process.env,
        OPEN_WEBSEARCH_QUIET_STARTUP: "true",
        DEFAULT_SEARCH_ENGINE: "startpage",
        ALLOWED_SEARCH_ENGINES: "startpage,duckduckgo,brave",
        SEARCH_MODE: "request"
      },
      maxBuffer: 1024 * 1024
    });
    return parseWebSearchPayload(stdout);
  } catch (error) {
    const maybe = error as {stdout?: string; message?: string};
    if (maybe.stdout) {
      return parseWebSearchPayload(maybe.stdout);
    }
    throw new Error(`Web search failed: ${maybe.message ?? String(error)}`);
  }
}

async function writeTextFile(pathValue: string, content: string): Promise<string> {
  const target = expandPath(pathValue);
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, content, "utf8");
  return `Wrote ${target}`;
}

async function makeDirectory(pathValue: string): Promise<string> {
  const target = expandPath(pathValue);
  await mkdir(target, {recursive: true});
  return `Created ${target}`;
}

async function runShell(command: string): Promise<string> {
  const {stdout, stderr} = await execAsync(command, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });

  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return output || "Command completed with no output.";
}

async function searchTextFallback(target: string, query: string, maxMatches: number): Promise<string> {
  const matches: string[] = [];

  await walk(target, async (path) => {
    if (matches.length >= maxMatches) {
      return;
    }

    try {
      const content = await readFile(path, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (matches.length < maxMatches && line.includes(query)) {
          matches.push(`${path}:${index + 1}:${line}`);
        }
      });
    } catch {
      // Ignore unreadable and binary-looking files in the fallback search.
    }
  });

  return matches.join("\n") || "No matches.";
}

async function walk(path: string, visit: (path: string) => Promise<void>): Promise<void> {
  const entries = await readdir(path, {withFileTypes: true});

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const child = resolve(path, entry.name);
    await visit(child);

    if (entry.isDirectory()) {
      await walk(child, visit);
    }
  }
}

function parseArgs(rawArgs: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function expandPath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith("~/")) {
    return resolve(homedir(), pathValue.slice(2));
  }

  return resolve(process.cwd(), pathValue);
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return {type: "string", description};
}

function numberSchema(description: string): Record<string, unknown> {
  return {type: "number", description};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Missing required string argument: ${name}`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function cleanSnippet(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function webSearchEngine(value: unknown): string {
  const engine = optionalString(value)?.toLowerCase();
  return engine && webSearchEngines.has(engine) ? engine : "startpage";
}

function parseWebSearchPayload(stdout: string): WebSearchPayload {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("Web search returned no JSON output.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart)) as WebSearchPayload;
  if (parsed.status !== "ok" && parsed.error?.message) {
    throw new Error(`Web search failed: ${parsed.error.message}`);
  }
  return parsed;
}

function uniqueWebResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const unique: WebSearchResult[] = [];

  for (const result of results) {
    if (!result.url || seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    unique.push(result);
  }

  return unique;
}
