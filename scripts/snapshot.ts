import { writeFileSync } from "node:fs";
import { decodeSchedule } from "../src/core/schedule-schema";
import type { Schedule } from "../src/core/types";
import { sheetEndpoint } from "../src/data/sheet-endpoint";
import { isSheetReply, scheduleOf } from "../src/ui/sheet-reply";

const OUTPUT = "src/data/schedule-snapshot.json";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

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
if (!isSheetReply(body)) die(`Unexpected reply: ${JSON.stringify(body).slice(0, 200)}`);
if (!body.ok) die(`The Sheet script says: ${body.error ?? "rejected"}`);
const schedule = scheduleOf(body);
if (schedule === undefined) die(`Unexpected reply: ${JSON.stringify(body).slice(0, 200)}`);

const decoded = decodeSchedule(schedule);
if (!decoded.success) die(`The Sheet has a problem: ${decoded.error}`);

writeFileSync(OUTPUT, JSON.stringify(withoutEmails(decoded.data), null, 2) + "\n");
const events = decoded.data.events.map((e) => `E${e.number}: ${e.heats.length} heats`).join(", ");
console.log(`Wrote ${OUTPUT} — ${decoded.data.compDate}, ${events}`);
