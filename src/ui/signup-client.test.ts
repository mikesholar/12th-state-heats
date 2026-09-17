import { postClaim, postRelease } from "./signup-client";
import { buildClaim, buildRelease } from "../core/signup";
import { makeRawSchedule, makeSchedule, makeEvent, makeHeat, makeLane } from "../test/factories";

const ENDPOINT = "https://script.example/exec";
const slot = { event: 1, heat: 1, lane: 1 };
const claim = buildClaim({ slot, email: "a@example.com", fields: { team: "Team A", athletes: "A One + A Two", division: "F/M Scaled" } });
const decodedSchedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ email: "a@example.com" })] })] })] });

const replying = (status: number, body: unknown): typeof fetch =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }));

describe("claiming a lane", () => {
  it("posts the claim as a bare JSON body and returns the fresh schedule", async () => {
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule() });

    const outcome = await postClaim({ endpoint: ENDPOINT, claim, fetchFn });

    expect(outcome).toEqual({ kind: "accepted", schedule: decodedSchedule });
    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", body: JSON.stringify(claim) }));
    const init = vi.mocked(fetchFn).mock.calls[0]?.[1];
    expect(init && "headers" in init && init.headers).toBeFalsy();
  });

  it("treats a duplicate as accepted", async () => {
    const outcome = await postClaim({ endpoint: ENDPOINT, claim, fetchFn: replying(200, { ok: true, duplicate: true, schedule: makeRawSchedule() }) });

    expect(outcome.kind).toBe("accepted");
  });

  it("is accepted without a schedule when the reply's schedule does not decode", async () => {
    const outcome = await postClaim({ endpoint: ENDPOINT, claim, fetchFn: replying(200, { ok: true, schedule: { compDate: "soon" } }) });

    expect(outcome).toEqual({ kind: "accepted" });
  });

  it("is rejected with the script's message, carrying the schedule when one comes back", async () => {
    const fetchFn = replying(200, { ok: false, error: "Lane 1 was just taken", schedule: makeRawSchedule() });

    expect(await postClaim({ endpoint: ENDPOINT, claim, fetchFn })).toEqual({ kind: "rejected", error: "Lane 1 was just taken", schedule: decodedSchedule });
    expect(await postClaim({ endpoint: ENDPOINT, claim, fetchFn: replying(200, { ok: false, error: "Sign-ups are closed" }) })).toEqual({
      kind: "rejected",
      error: "Sign-ups are closed",
    });
  });

  it("is rejected when the reply is not the script's envelope", async () => {
    expect(await postClaim({ endpoint: ENDPOINT, claim, fetchFn: replying(200, { hello: 1 }) })).toEqual({
      kind: "rejected",
      error: "Unexpected reply from the sheet",
    });
  });

  it("is unreachable when fetch throws, the status is not 2xx, or the endpoint is blank", async () => {
    const throwing: typeof fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await postClaim({ endpoint: ENDPOINT, claim, fetchFn: throwing })).toEqual({ kind: "unreachable" });
    expect(await postClaim({ endpoint: ENDPOINT, claim, fetchFn: replying(500, {}) })).toEqual({ kind: "unreachable" });
    const fetchFn = replying(200, { ok: true });
    expect(await postClaim({ endpoint: "", claim, fetchFn })).toEqual({ kind: "unreachable" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("releasing a lane", () => {
  it("posts the release and returns the fresh schedule", async () => {
    const release = buildRelease({ slot, email: "a@example.com" });
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule() });

    const outcome = await postRelease({ endpoint: ENDPOINT, release, fetchFn });

    expect(outcome).toEqual({ kind: "accepted", schedule: decodedSchedule });
    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", body: JSON.stringify(release) }));
  });
});
