// Stands in for the One CLI in tests. Logs each call's argv to FAKE_ONE_LOG and answers from FAKE_ONE_DATA.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_ONE_LOG) appendFileSync(process.env.FAKE_ONE_LOG, JSON.stringify(args) + "\n");
const data = JSON.parse(readFileSync(process.env.FAKE_ONE_DATA, "utf8"));

if (args[1] === "list") {
  console.log(JSON.stringify({ connections: data.connections ?? [] }));
} else if (args[1] === "actions" && args[2] === "execute") {
  const action = args[4];
  if (data.fail) {
    console.log(JSON.stringify({ error: data.fail }));
    process.exit(1);
  }
  let response = data.responses?.[action] ?? null;
  if (Array.isArray(response?.pages)) {
    const body = JSON.parse(args[args.indexOf("-d") + 1]);
    response = response.pages[body.page - 1] ?? [];
  }
  console.log(JSON.stringify({ dryRun: false, request: {}, response }));
} else {
  console.log(JSON.stringify({ error: `fake-one: unknown ${args.join(" ")}` }));
  process.exit(1);
}
