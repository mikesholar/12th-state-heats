import { callSheet } from "./sheet-fetch";

const ENDPOINT = "https://script.example/exec";

const replying = (status: number, body: unknown): typeof fetch =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }));

describe("calling the sheet script", () => {
  it("GETs with no-store and a timeout when there is no body", async () => {
    const fetchFn = replying(200, { ok: true });

    expect(await callSheet({ endpoint: ENDPOINT, fetchFn, timeoutMs: 1_000 })).toEqual({ body: { ok: true } });
    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(vi.mocked(fetchFn).mock.calls[0]?.[1]).not.toHaveProperty("method");
  });

  it("POSTs a bare body with no headers and a timeout", async () => {
    const fetchFn = replying(200, { ok: true });

    await callSheet({ endpoint: ENDPOINT, fetchFn, timeoutMs: 1_000, body: '{"a":1}' });

    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", body: '{"a":1}', signal: expect.any(AbortSignal) }));
    expect(vi.mocked(fetchFn).mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("is undefined for a blank endpoint (without fetching), a throw, a non-2xx status or a non-JSON body", async () => {
    const fetchFn = replying(200, { ok: true });
    expect(await callSheet({ endpoint: "", fetchFn, timeoutMs: 1_000 })).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();

    const throwing: typeof fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await callSheet({ endpoint: ENDPOINT, fetchFn: throwing, timeoutMs: 1_000 })).toBeUndefined();
    expect(await callSheet({ endpoint: ENDPOINT, fetchFn: replying(500, {}), timeoutMs: 1_000 })).toBeUndefined();

    const html: typeof fetch = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await callSheet({ endpoint: ENDPOINT, fetchFn: html, timeoutMs: 1_000 })).toBeUndefined();
  });
});
