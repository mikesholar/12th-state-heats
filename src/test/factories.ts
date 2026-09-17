import type { Event, Heat, Lane, Schedule } from "../core/types";
import type { Score } from "../core/score";
import type { Submission } from "../core/submission";

export const makeLane = (overrides?: Partial<Lane>): Lane => ({
  lane: 1,
  team: "Team A",
  athletes: "A One + A Two",
  division: "F/M Scaled",
  ...overrides,
});

export const makeHeat = (overrides?: Partial<Heat>): Heat => ({
  number: 1,
  start: "08:00",
  end: "08:08",
  lanes: [makeLane()],
  ...overrides,
});

export const makeEvent = (overrides?: Partial<Event>): Event => ({
  number: 1,
  title: "Test Event",
  format: "AMRAP 1",
  scoring: "rounds-reps",
  rx: "rx",
  scaled: "scaled",
  lanes: 8,
  heats: [makeHeat()],
  ...overrides,
});

export const DIVISIONS = ["F/F RX", "F/F Scaled", "F/M RX", "F/M Scaled", "M/M RX", "M/M Scaled"];

export const makeSchedule = (overrides?: Partial<Schedule>): Schedule => ({
  compDate: "2026-09-12",
  timeZone: "America/New_York",
  teamSize: 2,
  divisions: DIVISIONS,
  signupsOpen: true,
  events: [makeEvent()],
  ...overrides,
});

export const at = (hhmm: string, date = "2026-09-12"): Date =>
  new Date(`${date}T${hhmm}:00-04:00`);

export const makeScore = (overrides?: Partial<Extract<Score, { kind: "rounds-reps" }>>): Score => ({
  kind: "rounds-reps",
  rounds: 4,
  reps: 7,
  ...overrides,
});

export type RawObject = Readonly<Record<string, unknown>>;

export const makeRawLane = (overrides?: RawObject): RawObject => ({
  lane: 1,
  email: "a@example.com",
  team: "Team A",
  athletes: "A One + A Two",
  division: "F/M Scaled",
  ...overrides,
});

export const makeRawHeat = (overrides?: RawObject): RawObject => ({
  number: 1,
  start: "08:00",
  end: "08:08",
  lanes: [makeRawLane()],
  ...overrides,
});

export const makeRawEvent = (overrides?: RawObject): RawObject => ({
  number: 1,
  title: "Test Event",
  format: "AMRAP 1",
  scoring: "rounds-reps",
  rx: "rx",
  scaled: "scaled",
  lanes: 8,
  heats: [makeRawHeat()],
  ...overrides,
});

export const makeRawSchedule = (overrides?: RawObject): RawObject => ({
  compDate: "2026-09-12",
  timeZone: "America/New_York",
  teamSize: 2,
  divisions: DIVISIONS,
  signupsOpen: true,
  events: [makeRawEvent()],
  ...overrides,
});

export const makeSubmission = (overrides?: Partial<Submission>): Submission => ({
  clientId: "sub-1",
  submittedAt: "2026-09-12T13:45:00.000Z",
  judge: "Kim",
  event: 2,
  heat: 3,
  lane: 5,
  team: "Rays of Glory",
  division: "F/M Scaled",
  scoreKind: "rounds-reps",
  seconds: "",
  rounds: 4,
  reps: 7,
  ...overrides,
});
