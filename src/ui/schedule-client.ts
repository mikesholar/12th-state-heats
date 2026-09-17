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

export const fetchSchedule = async ({ endpoint, fetchFn }: FetchScheduleOptions): Promise<FetchOutcome> => {
  if (endpoint === "") return { kind: "unreachable" };
  try {
    const response = await fetchFn(endpoint);
    if (!response.ok) return { kind: "unreachable" };
    return outcomeOf(await response.json());
  } catch {
    return { kind: "unreachable" };
  }
};
