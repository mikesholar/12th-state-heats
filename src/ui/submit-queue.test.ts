import { enqueue, flush } from "./submit-queue";
import { loadQueue } from "./judge-store";
import type { PostResult } from "./score-client";
import { makeSubmission } from "../test/factories";

afterEach(() => localStorage.clear());

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const poster = (...results: readonly PostResult[]) => {
  const post = vi.fn<(submission: { clientId: string }) => Promise<PostResult>>();
  results.forEach((r) => post.mockResolvedValueOnce(r));
  return post;
};

describe("queueing and flushing submissions", () => {
  it("enqueue persists the record at the back of the queue", () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));

    expect(loadQueue().map((s) => s.clientId)).toEqual(["a", "b"]);
  });

  it("flush posts in order and empties the queue when everything is accepted", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    const post = poster({ kind: "accepted" }, { kind: "accepted" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(post.mock.calls.map(([s]) => s.clientId)).toEqual(["a", "b"]);
    expect(loadQueue()).toEqual([]);
    expect(outcome).toEqual({ pending: 0, rejected: [] });
  });

  it("flush stops at the first unreachable and keeps the rest queued", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    enqueue(makeSubmission({ clientId: "c" }));
    const post = poster({ kind: "accepted" }, { kind: "unreachable" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(post).toHaveBeenCalledTimes(2);
    expect(loadQueue().map((s) => s.clientId)).toEqual(["b", "c"]);
    expect(outcome).toEqual({ pending: 2, rejected: [] });
  });

  it("flush drops a rejected record, reports it, and continues", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    const post = poster({ kind: "rejected", error: "Unknown scoreKind" }, { kind: "accepted" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(loadQueue()).toEqual([]);
    expect(outcome).toEqual({ pending: 0, rejected: [{ clientId: "a", error: "Unknown scoreKind" }] });
  });

  it("flush does nothing without an endpoint", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    const post = poster();

    const outcome = await flush({ endpoint: "", post });

    expect(post).not.toHaveBeenCalled();
    expect(outcome).toEqual({ pending: 1, rejected: [] });
  });
});
