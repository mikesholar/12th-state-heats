import type { FetchOutcome } from "../core/load-schedule";
import { decodeSchedule } from "../core/schedule-schema";

type FetchScheduleOptions = {
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
};

type Reply = { readonly ok: boolean; readonly error?: string; readonly schedule?: unknown };

const isReply = (value: unknown): value is Reply =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  typeof value.ok === "boolean" &&
  (!("error" in value) || typeof value.error === "string");

const outcomeOf = (body: unknown): FetchOutcome => {
  if (!isReply(body)) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  if (!body.ok) return { kind: "invalid", reason: body.error ?? "Rejected by the sheet" };
  if (body.schedule === undefined) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  const decoded = decodeSchedule(body.schedule);
  return decoded.success ? { kind: "loaded", schedule: decoded.data } : { kind: "invalid", reason: decoded.error };
};

const readBody = async ({ endpoint, fetchFn }: FetchScheduleOptions): Promise<{ readonly body: unknown } | undefined> => {
  try {
    const response = await fetchFn(endpoint, { cache: "no-store" });
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
