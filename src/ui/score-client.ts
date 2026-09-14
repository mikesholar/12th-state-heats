import type { Submission } from "../core/submission";

export type PostResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "unreachable" };

type PostScoreOptions = {
  readonly endpoint: string;
  readonly submission: Submission;
  readonly fetchFn: typeof fetch;
};

const isReply = (value: unknown): value is { readonly ok: boolean; readonly error?: string } =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  typeof value.ok === "boolean" &&
  (!("error" in value) || typeof value.error === "string");

const readReply = async (response: Response): Promise<PostResult> => {
  if (!response.ok) return { kind: "unreachable" };
  const body: unknown = await response.json();
  if (!isReply(body)) return { kind: "unreachable" };
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
