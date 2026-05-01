import {execFile} from "node:child_process";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import type {UiConfig} from "./types.js";
import {createQuietSpinner, printBox} from "./ui.js";

const execFileAsync = promisify(execFile);
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function maybePrintUpdateNotice(ui: UiConfig): Promise<void> {
  try {
    const update = await getUpdateInfo();
    if (update.available) {
      printBox("update", "A new version of sh-agent is available.\n\nRun: -update", ui);
    }
  } catch {
    // Update checks should never block normal CLI use.
  }
}

export async function runUpdate(ui: UiConfig): Promise<void> {
  const loader = createQuietSpinner("Checking for updates", ui);

  try {
    const update = await getUpdateInfo();
    if (!update.available) {
      loader.stop();
      printBox("update", "sh-agent is already up to date.", ui);
      return;
    }

    loader.setText("Pulling latest changes");
    await exec("git", ["pull", "--ff-only"]);
    loader.setText("Installing dependencies");
    await exec("npm", ["install"]);
    loader.setText("Building sh-agent");
    await exec("npm", ["run", "build"]);
    loader.setText("Updating shell commands");
    await exec("npm", ["run", "install:aliases"]);
    loader.stop();
    printBox("update", "Updated sh-agent.\n\nRun: exec zsh", ui);
  } catch (error) {
    loader.fail("update failed");
    printBox("error", error instanceof Error ? error.message : String(error), ui);
  }
}

async function getUpdateInfo(): Promise<{available: boolean}> {
  const inside = (await exec("git", ["rev-parse", "--is-inside-work-tree"])).stdout.trim();
  if (inside !== "true") {
    return {available: false};
  }

  const branch = (await exec("git", ["branch", "--show-current"])).stdout.trim() || "main";
  const local = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  const remote = (await exec("git", ["ls-remote", "origin", `refs/heads/${branch}`])).stdout
    .trim()
    .split(/\s+/)[0];

  if (!remote || remote === local) {
    return {available: false};
  }

  try {
    await exec("git", ["merge-base", "--is-ancestor", local, remote]);
    return {available: true};
  } catch {
    return {available: false};
  }
}

async function exec(command: string, args: string[]): Promise<{stdout: string; stderr: string}> {
  return execFileAsync(command, args, {
    cwd: appRoot,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}
