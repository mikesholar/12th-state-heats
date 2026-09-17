import { decodeSchedule } from "../core/schedule-schema";
import type { ClaimRequest, ReleaseRequest } from "../core/signup";
import type { Schedule } from "../core/types";
import { callSheet } from "./sheet-fetch";
import { isSheetReply, scheduleOf, type SheetReply } from "./sheet-reply";

export type WriteOutcome =
  | { readonly kind: "accepted"; readonly schedule?: Schedule }
  | { readonly kind: "rejected"; readonly error: string; readonly schedule?: Schedule }
  | { readonly kind: "unreachable" };

type PostOptions = {
  readonly endpoint: string;
  readonly body: ClaimRequest | ReleaseRequest;
  readonly fetchFn: typeof fetch;
};

const WRITE_TIMEOUT_MS = 15_000;

const decodedScheduleOf = (reply: SheetReply): Schedule | undefined => {
  const raw = scheduleOf(reply);
  if (raw === undefined) return undefined;
  const decoded = decodeSchedule(raw);
  return decoded.success ? decoded.data : undefined;
};

const outcomeOf = (body: unknown): WriteOutcome => {
  if (!isSheetReply(body)) return { kind: "rejected", error: "Unexpected reply from the sheet" };
  const schedule = decodedScheduleOf(body);
  if (body.ok) return schedule === undefined ? { kind: "accepted" } : { kind: "accepted", schedule };
  const error = body.error ?? "Rejected by the sheet";
  return schedule === undefined ? { kind: "rejected", error } : { kind: "rejected", error, schedule };
};

const post = async ({ endpoint, body, fetchFn }: PostOptions): Promise<WriteOutcome> => {
  const call = await callSheet({ endpoint, fetchFn, timeoutMs: WRITE_TIMEOUT_MS, body: JSON.stringify(body) });
  return call === undefined ? { kind: "unreachable" } : outcomeOf(call.body);
};

type PostClaimOptions = { readonly endpoint: string; readonly claim: ClaimRequest; readonly fetchFn: typeof fetch };

export const postClaim = ({ endpoint, claim, fetchFn }: PostClaimOptions): Promise<WriteOutcome> => post({ endpoint, body: claim, fetchFn });

type PostReleaseOptions = { readonly endpoint: string; readonly release: ReleaseRequest; readonly fetchFn: typeof fetch };

export const postRelease = ({ endpoint, release, fetchFn }: PostReleaseOptions): Promise<WriteOutcome> =>
  post({ endpoint, body: release, fetchFn });
