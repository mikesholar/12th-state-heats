import type { Event, Heat, Lane, Schedule } from "../core/types";

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
  rx: "rx",
  scaled: "scaled",
  heats: [makeHeat()],
  ...overrides,
});

export const makeSchedule = (overrides?: Partial<Schedule>): Schedule => ({
  compDate: "2026-09-13",
  timeZone: "America/New_York",
  events: [makeEvent()],
  ...overrides,
});

export const at = (hhmm: string, date = "2026-09-13"): Date =>
  new Date(`${date}T${hhmm}:00-04:00`);
