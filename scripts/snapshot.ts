import { writeFileSync } from "node:fs";
import { decodeSchedule } from "../src/core/schedule-schema";
import type { Schedule } from "../src/core/types";
import { sheetEndpoint } from "../src/data/sheet-endpoint";

const OUTPUT = "src/data/schedule-snapshot.json";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const hasSchedule = (value: unknown): value is { readonly ok: true; readonly schedule: unknown } =>
  typeof value === "object" && value !== null && "ok" in value && value.ok === true && "schedule" in value;

const withoutEmails = (schedule: Schedule): Schedule => ({
  ...schedule,
  events: schedule.events.map((event) => ({
    ...event,
    heats: event.heats.map((heat) => ({
      ...heat,
      lanes: heat.lanes.map(({ email: _email, ...lane }) => lane),
    })),
  })),
});

const endpoint = process.env.SHEET_ENDPOINT ?? sheetEndpoint;
if (endpoint === "") die("sheetEndpoint is empty — see docs/deploy.md");

const response = await fetch(endpoint);
if (!response.ok) die(`Sheet endpoint answered ${response.status}`);
const body: unknown = await response.json();
if (!hasSchedule(body)) die(`Unexpected reply: ${JSON.stringify(body).slice(0, 200)}`);

const decoded = decodeSchedule(body.schedule);
if (!decoded.success) die(`The Sheet has a problem: ${decoded.error}`);

writeFileSync(OUTPUT, JSON.stringify(withoutEmails(decoded.data), null, 2) + "\n");
const events = decoded.data.events.map((e) => `E${e.number}: ${e.heats.length} heats`).join(", ");
console.log(`Wrote ${OUTPUT} — ${decoded.data.compDate}, ${events}`);
