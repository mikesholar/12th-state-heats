import type { FetchOutcome } from "../core/load-schedule";
import { decodeSchedule } from "../core/schedule-schema";
import { callSheet } from "./sheet-fetch";
import { isSheetReply, scheduleOf } from "./sheet-reply";

type FetchScheduleOptions = {
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
};

const FETCH_TIMEOUT_MS = 20_000;

const outcomeOf = (body: unknown): FetchOutcome => {
  if (!isSheetReply(body)) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  if (!body.ok) return { kind: "invalid", reason: body.error ?? "Rejected by the sheet" };
  const schedule = scheduleOf(body);
  if (schedule === undefined) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  const decoded = decodeSchedule(schedule);
  return decoded.success ? { kind: "loaded", schedule: decoded.data } : { kind: "invalid", reason: decoded.error };
};

export const fetchSchedule = async ({ endpoint, fetchFn }: FetchScheduleOptions): Promise<FetchOutcome> => {
  const call = await callSheet({ endpoint, fetchFn, timeoutMs: FETCH_TIMEOUT_MS });
  return call === undefined ? { kind: "unreachable" } : outcomeOf(call.body);
};
