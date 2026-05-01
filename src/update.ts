import {execFile} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import type {UiConfig} from "./types.js";
import {createQuietSpinner, printBox} from "./ui.js";

const execFileAsync = promisify(execFile);
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const updateCachePath = join(tmpdir(), "sh-agent-update-cache.json");
const passiveCheckTtlMs = 6 * 60 * 60 * 1000;

type UpdateCache = {
  checkedAt: string;
  available: boolean;
};

type UpdateInfo = {
  available: boolean;
  branch: string;
};

export async function maybePrintUpdateNotice(ui: UiConfig): Promise<void> {
  try {
    const cached = await readUpdateCache();
    if (cached && Date.now() - Date.parse(cached.checkedAt) < passiveCheckTtlMs) {
      if (cached.available) {
        printBox("update", "A new version of sh-agent is available.\n\nRun: -update", ui);
      }
      return;
    }

    const update = await getUpdateInfo();
    await writeUpdateCache(update.available);
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
    await writeUpdateCache(update.available);
    if (!update.available) {
      loader.stop();
      printBox("update", "sh-agent is already up to date.", ui);
      return;
    }

    loader.setText("Pulling latest changes");
    await exec("git", ["fetch", "origin", update.branch]);
    await exec("git", ["merge", "--ff-only", `origin/${update.branch}`]);
    loader.setText("Installing dependencies");
    await exec("npm", ["install"]);
    loader.setText("Building sh-agent");
    await exec("npm", ["run", "build"]);
    loader.setText("Updating shell commands");
    await exec("npm", ["run", "install:aliases"]);
    await writeUpdateCache(false);
    loader.stop();
    printBox("update", "Updated sh-agent.\n\nRun: exec zsh", ui);
  } catch (error) {
    loader.fail("update failed");
    printBox("error", error instanceof Error ? error.message : String(error), ui);
  }
}

async function readUpdateCache(): Promise<UpdateCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(updateCachePath, "utf8")) as Partial<UpdateCache>;
    if (typeof parsed.checkedAt === "string" && typeof parsed.available === "boolean") {
      return {
        checkedAt: parsed.checkedAt,
        available: parsed.available
      };
    }
  } catch {
    // Missing or invalid cache means do a live check.
  }

  return undefined;
}

async function writeUpdateCache(available: boolean): Promise<void> {
  await writeFile(
    updateCachePath,
    `${JSON.stringify({checkedAt: new Date().toISOString(), available}, null, 2)}\n`,
    "utf8"
  );
}

async function getUpdateInfo(): Promise<UpdateInfo> {
  const fallbackBranch = "main";
  const inside = (await exec("git", ["rev-parse", "--is-inside-work-tree"])).stdout.trim();
  if (inside !== "true") {
    return {available: false, branch: fallbackBranch};
  }

  const branch = (await exec("git", ["branch", "--show-current"])).stdout.trim() || fallbackBranch;
  const local = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  const remote = (await exec("git", ["ls-remote", "origin", `refs/heads/${branch}`])).stdout
    .trim()
    .split(/\s+/)[0];

  if (!remote || remote === local) {
    return {available: false, branch};
  }

  try {
    await exec("git", ["merge-base", "--is-ancestor", local, remote]);
    return {available: true, branch};
  } catch {
    return {available: false, branch};
  }
}

async function exec(command: string, args: string[]): Promise<{stdout: string; stderr: string}> {
  return execFileAsync(command, args, {
    cwd: appRoot,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}
