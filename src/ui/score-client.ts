import type { Submission } from "../core/submission";
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

const readReply = async (response: Response): Promise<PostResult> => {
  if (!response.ok) return { kind: "unreachable" };
  const body: unknown = await response.json();
  if (!isSheetReply(body)) return { kind: "unreachable" };
  return body.ok ? { kind: "accepted" } : { kind: "rejected", error: body.error ?? "Rejected by the sheet" };
};

export const postScore = async ({ endpoint, submission, fetchFn }: PostScoreOptions): Promise<PostResult> => {
  try {
    const response = await fetchFn(endpoint, { method: "POST", body: JSON.stringify(submission) });
    return await readReply(response);
  } catch {
    return { kind: "unreachable" };
  }
};
