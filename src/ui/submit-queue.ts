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

export const enqueue = (submission: Submission): void => saveQueue([...loadQueue(), submission]);

const defaultPoster =
  (endpoint: string): Poster =>
  (submission) =>
    postScore({ endpoint, submission, fetchFn: fetch });

const drain = async (queue: readonly Submission[], post: Poster, rejected: readonly Rejection[]): Promise<FlushOutcome> => {
  const [head, ...rest] = queue;
  if (!head) {
    saveQueue([]);
    return { pending: 0, rejected };
  }
  const result = await post(head);
  if (result.kind === "unreachable") {
    saveQueue(queue);
    return { pending: queue.length, rejected };
  }
  const nextRejected = result.kind === "rejected" ? [...rejected, { clientId: head.clientId, error: result.error }] : rejected;
  saveQueue(rest);
  return drain(rest, post, nextRejected);
};

export const flush = async ({ endpoint, post }: FlushOptions): Promise<FlushOutcome> => {
  const queue = loadQueue();
  if (!endpoint) return { pending: queue.length, rejected: [] };
  return drain(queue, post ?? defaultPoster(endpoint), []);
};
