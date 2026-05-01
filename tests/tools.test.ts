import {mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {executeTool, isMutatingTool, toolDefinitions} from "../src/tools.js";

const readOnlyTools = new Set(["list_files", "find_files", "read_file", "search_text"]);

let originalCwd = process.cwd();
let tempDir = "";

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(join(tmpdir(), "sh-agent-test-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe("tool approval boundaries", () => {
  it("keeps ask mode read-only", () => {
    const askTools = toolDefinitions("ask").map((tool) => tool.function.name);

    assert.deepEqual(askTools, ["list_files", "find_files", "read_file", "search_text"]);
    assert.equal(askTools.every((name) => readOnlyTools.has(name)), true);
    assert.equal(askTools.some((name) => isMutatingTool(name)), false);
  });

  it("requires approval for every act-only tool", () => {
    const actTools = toolDefinitions("act").map((tool) => tool.function.name);
    const actOnlyTools = actTools.filter((name) => !readOnlyTools.has(name));

    assert.deepEqual(actOnlyTools, ["write_file", "make_dir", "run_shell"]);
    assert.equal(actOnlyTools.every((name) => isMutatingTool(name)), true);
    assert.equal([...readOnlyTools].some((name) => isMutatingTool(name)), false);
  });
});

describe("tool execution", () => {
  it("lists a file path without treating it as a directory", async () => {
    const filePath = join(tempDir, "README.md");
    await writeFile(filePath, "hello\n", "utf8");

    const output = await executeTool("list_files", JSON.stringify({path: filePath}), "ask");

    assert.equal(output, `file ${filePath}`);
  });

  it("does not allow mutating tools in ask mode", async () => {
    const output = await executeTool("write_file", JSON.stringify({path: "x.txt", content: "nope"}), "ask");

    assert.equal(output, "Tool write_file is not available in ask mode.");
  });

  it("writes files, creates directories, and runs shell commands in act mode", async () => {
    await executeTool("make_dir", JSON.stringify({path: "site/assets"}), "act");
    const directory = await stat(join(tempDir, "site", "assets"));
    assert.equal(directory.isDirectory(), true);

    await executeTool("write_file", JSON.stringify({path: "site/index.html", content: "<h1>Hello</h1>\n"}), "act");
    assert.equal(await readFile(join(tempDir, "site", "index.html"), "utf8"), "<h1>Hello</h1>\n");

    const output = await executeTool("run_shell", JSON.stringify({command: "printf sh-agent"}), "act");
    assert.equal(output, "sh-agent");
  });

  it("reports missing required search arguments", async () => {
    await assert.rejects(
      () => executeTool("search_text", JSON.stringify({path: "."}), "ask"),
      /Missing required string argument: query/
    );
  });
});
