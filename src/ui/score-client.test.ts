import { postScore } from "./score-client";
import { makeSubmission } from "../test/factories";

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const fetchReplying = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("posting a score to the sheet", () => {
  it("sends the submission as a JSON body with no content-type header", async () => {
    const fetchFn = fetchReplying(200, { ok: true });
    const submission = makeSubmission();

    await postScore({ endpoint: ENDPOINT, submission, fetchFn });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual(submission);
  });

  it("reports acceptance", async () => {
    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn: fetchReplying(200, { ok: true }) });

    expect(result).toEqual({ kind: "accepted" });
  });

  it("treats a duplicate as accepted", async () => {
    const result = await postScore({
      endpoint: ENDPOINT,
      submission: makeSubmission(),
      fetchFn: fetchReplying(200, { ok: true, duplicate: true }),
    });

    expect(result).toEqual({ kind: "accepted" });
  });

  it("reports a server rejection with its message", async () => {
    const result = await postScore({
      endpoint: ENDPOINT,
      submission: makeSubmission(),
      fetchFn: fetchReplying(200, { ok: false, error: "Unknown scoreKind" }),
    });

    expect(result).toEqual({ kind: "rejected", error: "Unknown scoreKind" });
  });

  it("reports a network failure when fetch throws", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn });

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("reports a network failure on a non-2xx status", async () => {
    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn: fetchReplying(502, "bad gateway") });

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("reports a network failure when the body is not the expected JSON", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>login</html>", { status: 200 }));

    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn });

    expect(result).toEqual({ kind: "unreachable" });
  });
});
