#!/usr/bin/env node
import {chmod, copyFile, mkdir, readFile, symlink, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";

const binDir = join(homedir(), ".local", "bin");
const completionDir = join(homedir(), ".zsh", "completions");
const zshrcPath = join(homedir(), ".zshrc");
const target = resolve("dist", "cli.js");
const completionSource = resolve("completions", "_sh-agent");
const completionTarget = join(completionDir, "_sh-agent");
const commands = ["-ask", "-act", "-model", "-provider", "-usage", "-custom", "-history", "-log", "-help", "-update"];
const commandModes = {
  "-ask": "ask",
  "-act": "act",
  "-model": "model",
  "-provider": "provider",
  "-usage": "usage",
  "-custom": "custom",
  "-history": "history",
  "-log": "history",
  "-help": "help",
  "-update": "update"
};
const zshrcBlock = [
  "# sh-agent completions",
  "# The aliases use noglob so prompts can contain ? [ ] * without quotes.",
  ...commands.map((command) => `alias -- ${command}='noglob ${target} ${commandModes[command]}'`),
  `fpath=(${completionDir} $fpath)`,
  "autoload -Uz compinit",
  "compinit",
  "autoload -Uz _sh-agent",
  "compdef _sh-agent sh-agent",
  ...commands.map((command) => `compdef _sh-agent ${command}`),
  "# end sh-agent completions"
].join("\n");

await mkdir(binDir, {recursive: true});
await mkdir(completionDir, {recursive: true});
await chmod(target, 0o755);

for (const command of commands) {
  const link = join(binDir, command);
  await rm(link, {force: true});
  await symlink(target, link);
  console.log(`${command} -> ${target}`);
}

await copyFile(completionSource, completionTarget);
console.log(`zsh completion -> ${completionTarget}`);

await ensureZshrcCompletionBlock();

console.log(`\nInstalled aliases in ${binDir}`);
console.log(`Configured zsh completions in ${zshrcPath}`);

async function ensureZshrcCompletionBlock() {
  let zshrc = "";

  try {
    zshrc = await readFile(zshrcPath, "utf8");
  } catch {
    // Missing ~/.zshrc is fine; create it below.
  }

  const start = "# sh-agent completions";
  const end = "# end sh-agent completions";
  const startIndex = zshrc.indexOf(start);
  const endIndex = zshrc.indexOf(end);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = zshrc.slice(0, startIndex).trimEnd();
    const after = zshrc.slice(endIndex + end.length).trimStart();
    const next = [before, zshrcBlock, after].filter(Boolean).join("\n\n");
    await writeFile(zshrcPath, `${next}\n`, "utf8");
    return;
  }

  const separator = zshrc.trim() ? "\n\n" : "";
  await writeFile(zshrcPath, `${zshrc.trimEnd()}${separator}${zshrcBlock}\n`, "utf8");
}
