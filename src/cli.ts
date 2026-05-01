#!/usr/bin/env node
import {basename} from "node:path";
import {runAct, runAsk, runCustom, runHistory, runModelPicker, runProviderPicker, runUsage} from "./commands.js";
import {loadConfig} from "./config.js";
import {maybePrintUpdateNotice, runUpdate} from "./update.js";
import {printHelp} from "./ui.js";

const aliasCommands = new Map<string, string>([
  ["-ask", "ask"],
  ["-act", "act"],
  ["-model", "model"],
  ["-provider", "provider"],
  ["-usage", "usage"],
  ["-custom", "custom"],
  ["-history", "history"],
  ["-log", "history"],
  ["-help", "help"],
  ["-update", "update"]
]);

async function main(): Promise<void> {
  const invokedAs = basename(process.argv[1] ?? "");
  const aliasCommand = aliasCommands.get(invokedAs);
  const command = aliasCommand ?? process.argv[2];
  const args = aliasCommand ? process.argv.slice(2) : process.argv.slice(3);
  const prompt = args.join(" ");
  const config = await loadConfig();

  if (command !== "update" && command !== undefined) {
    await maybePrintUpdateNotice(config.ui);
  }

  switch (command) {
    case "ask":
      await runAsk(prompt);
      return;
    case "act":
      await runAct(prompt);
      return;
    case "model":
      await runModelPicker(args);
      return;
    case "provider":
      await runProviderPicker();
      return;
    case "usage":
      await runUsage();
      return;
    case "custom":
      await runCustom();
      return;
    case "history":
    case "log":
      await runHistory();
      return;
    case "update":
      await runUpdate(config.ui);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp(config.ui);
      return;
    default:
      printHelp(config.ui);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
