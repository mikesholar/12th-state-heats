import type { Submission } from "../core/submission";
import { callSheet } from "./sheet-fetch";
import { isSheetReply } from "./sheet-reply";

export type PostResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "unreachable" };

type PostScoreOptions = {
  readonly endpoint: string;
  readonly submission: Submission;
  readonly fetchFn: typeof fetch;
};

const SCORE_TIMEOUT_MS = 15_000;

const resultOf = (body: unknown): PostResult => {
  if (!isSheetReply(body)) return { kind: "unreachable" };
  return body.ok ? { kind: "accepted" } : { kind: "rejected", error: body.error ?? "Rejected by the sheet" };
};

export const postScore = async ({ endpoint, submission, fetchFn }: PostScoreOptions): Promise<PostResult> => {
  const call = await callSheet({ endpoint, fetchFn, timeoutMs: SCORE_TIMEOUT_MS, body: JSON.stringify(submission) });
  return call === undefined ? { kind: "unreachable" } : resultOf(call.body);
};
