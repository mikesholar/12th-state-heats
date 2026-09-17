import { fetchSchedule } from "./schedule-client";
import { makeRawSchedule, makeSchedule, makeEvent, makeHeat, makeLane } from "../test/factories";

const ENDPOINT = "https://script.example/exec";

const replying = (status: number, body: unknown): typeof fetch =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("fetching the schedule from the sheet", () => {
  it("decodes a good reply", async () => {
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule() });

    const outcome = await fetchSchedule({ endpoint: ENDPOINT, fetchFn });

    expect(outcome).toEqual({
      kind: "loaded",
      schedule: makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ email: "a@example.com" })] })] })] }),
    });
    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("is unreachable when the endpoint is not configured, without fetching", async () => {
    const fetchFn = replying(200, {});

    expect(await fetchSchedule({ endpoint: "", fetchFn })).toEqual({ kind: "unreachable" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is unreachable when fetch throws", async () => {
    const fetchFn: typeof fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({ kind: "unreachable" });
  });

  it("is unreachable on a non-2xx status", async () => {
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: replying(500, { ok: true }) })).toEqual({ kind: "unreachable" });
  });

  it("is unreachable on a non-JSON body", async () => {
    const html: typeof fetch = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: html })).toEqual({ kind: "unreachable" });
  });

  it("is invalid with the script's error when the script says no", async () => {
    const fetchFn = replying(200, { ok: false, error: "Run setup() in the script editor first" });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({ kind: "invalid", reason: "Run setup() in the script editor first" });
  });

  it("is invalid with the decoder's message when the sheet content is wrong", async () => {
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule({ compDate: "soon" }) });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({
      kind: "invalid",
      reason: 'Settings: compDate "soon" must be YYYY-MM-DD',
    });
  });

  it("is invalid when the reply has no schedule", async () => {
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: replying(200, { ok: true }) })).toEqual({
      kind: "invalid",
      reason: "Unexpected reply from the sheet",
    });
  });
});
