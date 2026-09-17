import type { FetchOutcome } from "../core/load-schedule";
import { decodeSchedule } from "../core/schedule-schema";
import { isSheetReply, scheduleOf } from "./sheet-reply";

type FetchScheduleOptions = {
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
};

const FETCH_TIMEOUT_MS = 8_000;

const outcomeOf = (body: unknown): FetchOutcome => {
  if (!isSheetReply(body)) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  if (!body.ok) return { kind: "invalid", reason: body.error ?? "Rejected by the sheet" };
  const schedule = scheduleOf(body);
  if (schedule === undefined) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  const decoded = decodeSchedule(schedule);
  return decoded.success ? { kind: "loaded", schedule: decoded.data } : { kind: "invalid", reason: decoded.error };
};

const readBody = async ({ endpoint, fetchFn }: FetchScheduleOptions): Promise<{ readonly body: unknown } | undefined> => {
  try {
    const response = await fetchFn(endpoint, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    return { body: await response.json() };
  } catch {
    return undefined;
  }
};

export const fetchSchedule = async (options: FetchScheduleOptions): Promise<FetchOutcome> => {
  if (options.endpoint === "") return { kind: "unreachable" };
  const read = await readBody(options);
  return read === undefined ? { kind: "unreachable" } : outcomeOf(read.body);
};
