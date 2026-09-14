import type { Submission } from "../core/submission";
import { loadQueue, saveQueue } from "./judge-store";
import { postScore, type PostResult } from "./score-client";

export type Rejection = { readonly clientId: string; readonly error: string };

export type FlushOutcome = { readonly pending: number; readonly rejected: readonly Rejection[] };

type Poster = (submission: Submission) => Promise<PostResult>;

type FlushOptions = {
  readonly endpoint: string;
  readonly post?: Poster;
};

type DrainOptions = { readonly post: Poster; readonly rejected: readonly Rejection[] };

export const enqueue = (submission: Submission): void => saveQueue([...loadQueue(), submission]);

const remove = (clientId: string): void => saveQueue(loadQueue().filter((s) => s.clientId !== clientId));

const defaultPoster =
  (endpoint: string): Poster =>
  (submission) =>
    postScore({ endpoint, submission, fetchFn: fetch });

const drain = async ({ post, rejected }: DrainOptions): Promise<FlushOutcome> => {
  const [head] = loadQueue();
  if (!head) return { pending: 0, rejected };
  const result = await post(head);
  if (result.kind === "unreachable") return { pending: loadQueue().length, rejected };
  remove(head.clientId);
  const nextRejected = result.kind === "rejected" ? [...rejected, { clientId: head.clientId, error: result.error }] : rejected;
  return drain({ post, rejected: nextRejected });
};

export const flush = async ({ endpoint, post }: FlushOptions): Promise<FlushOutcome> => {
  if (!endpoint) return { pending: loadQueue().length, rejected: [] };
  return drain({ post: post ?? defaultPoster(endpoint), rejected: [] });
};
