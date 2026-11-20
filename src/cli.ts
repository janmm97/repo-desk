#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export const HELP = `repo-desk ${VERSION}: GitHub triage on One + a local model. You approve every write.

Usage: repo-desk <command> [options]

Commands:
  help             Show this help
  version          Print the version
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd = "help"] = argv;
  if (cmd === "version" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  return 2;
}

function isEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
