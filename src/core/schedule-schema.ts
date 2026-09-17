import { fail, ok, type Result } from "./result";
import type { Event, Heat, Lane, Schedule, ScoringFormat } from "./types";
import { validateSchedule } from "./validate-schedule";

type Raw = Readonly<Record<string, unknown>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : shown(value));

const text = (raw: Raw, key: string, where: string): Result<string> => {
  const value = trimmed(raw[key]);
  return value === "" ? fail(`${where}: ${key} is missing`) : ok(value);
};

const optionalText = (raw: Raw, key: string): string => trimmed(raw[key]);

const integer = (raw: Raw, key: string, where: string): Result<number> => {
  const value = trimmed(raw[key]);
  const parsed = value === "" ? NaN : Number(value);
  return Number.isInteger(parsed) ? ok(parsed) : fail(`${where}: ${key} "${shown(raw[key])}" must be a whole number`);
};

const optionalInteger = (raw: Raw, key: string, where: string): Result<number | undefined> =>
  trimmed(raw[key]) === "" ? ok(undefined) : integer(raw, key, where);

const boolean = (raw: Raw, key: string, where: string): Result<boolean> => {
  const value = raw[key];
  if (typeof value === "boolean") return ok(value);
  const upper = trimmed(value).toUpperCase();
  if (upper === "TRUE") return ok(true);
  if (upper === "FALSE") return ok(false);
  return fail(`${where}: ${key} must be TRUE or FALSE`);
};

const list = (raw: Raw, key: string, where: string): Result<readonly unknown[]> =>
  Array.isArray(raw[key]) ? ok(raw[key]) : fail(`${where}: ${key} must be a list`);

const all = <T>(results: readonly Result<T>[]): Result<readonly T[]> => {
  const failure = results.find((result) => !result.success);
  if (failure && !failure.success) return fail(failure.error);
  return ok(results.flatMap((result) => (result.success ? [result.data] : [])));
};

const clock = (raw: Raw, key: string, where: string): Result<string> => {
  const value = text(raw, key, where);
  if (!value.success) return value;
  return TIME_PATTERN.test(value.data) ? value : fail(`${where}: ${key} "${value.data}" must be HH:MM`);
};

const scoringFormat = (raw: Raw, where: string): Result<ScoringFormat> => {
  const value = trimmed(raw.scoring);
  if (value === "time-or-rounds" || value === "rounds-reps") return ok(value);
  return fail(`${where}: scoring "${shown(raw.scoring)}" must be time-or-rounds or rounds-reps`);
};

const decodeLane = (where: string) => (value: unknown): Result<Lane> => {
  if (!isRaw(value)) return fail(`Slots: ${where}: a lane entry is not an object`);
  const lane = integer(value, "lane", `Slots: ${where}`);
  if (!lane.success) return fail(lane.error);
  const laneWhere = `Slots: ${where} lane ${lane.data}`;
  const team = text(value, "team", laneWhere);
  if (!team.success) return fail(team.error);
  const athletes = text(value, "athletes", laneWhere);
  if (!athletes.success) return fail(athletes.error);
  const division = text(value, "division", laneWhere);
  if (!division.success) return fail(division.error);
  const email = optionalText(value, "email");
  return ok({
    lane: lane.data,
    team: team.data,
    athletes: athletes.data,
    division: division.data,
    ...(email === "" ? {} : { email }),
  });
};

const decodeHeat = (eventNumber: number) => (value: unknown): Result<Heat> => {
  if (!isRaw(value)) return fail(`Heats: Event ${eventNumber}: a heat entry is not an object`);
  const number = integer(value, "number", `Heats: Event ${eventNumber}`);
  if (!number.success) return fail(number.error);
  const where = `Event ${eventNumber} Heat ${number.data}`;
  const start = clock(value, "start", `Heats: ${where}`);
  if (!start.success) return fail(start.error);
  const end = clock(value, "end", `Heats: ${where}`);
  if (!end.success) return fail(end.error);
  const lanes = list(value, "lanes", `Heats: ${where}`);
  if (!lanes.success) return fail(lanes.error);
  const decodedLanes = all(lanes.data.map(decodeLane(where)));
  if (!decodedLanes.success) return fail(decodedLanes.error);
  return ok({ number: number.data, start: start.data, end: end.data, lanes: decodedLanes.data });
};

const decodeEvent = (value: unknown): Result<Event> => {
  if (!isRaw(value)) return fail("Events: an event entry is not an object");
  const number = integer(value, "number", "Events");
  if (!number.success) return fail(number.error);
  const where = `Events: Event ${number.data}`;
  const title = text(value, "title", where);
  if (!title.success) return fail(title.error);
  const scoring = scoringFormat(value, where);
  if (!scoring.success) return fail(scoring.error);
  const capSeconds = optionalInteger(value, "capSeconds", where);
  if (!capSeconds.success) return fail(capSeconds.error);
  const lanes = integer(value, "lanes", where);
  if (!lanes.success) return fail(lanes.error);
  const heats = list(value, "heats", where);
  if (!heats.success) return fail(heats.error);
  const decodedHeats = all(heats.data.map(decodeHeat(number.data)));
  if (!decodedHeats.success) return fail(decodedHeats.error);
  return ok({
    number: number.data,
    title: title.data,
    format: optionalText(value, "format"),
    scoring: scoring.data,
    ...(capSeconds.data === undefined ? {} : { capSeconds: capSeconds.data }),
    rx: optionalText(value, "rx"),
    scaled: optionalText(value, "scaled"),
    lanes: lanes.data,
    heats: decodedHeats.data,
  });
};

const decodeDivisions = (raw: Raw): Result<readonly string[]> => {
  const value = list(raw, "divisions", "Settings");
  if (!value.success) return fail(value.error);
  return ok(value.data.map(trimmed).filter((division) => division !== ""));
};

const decodeShape = (raw: Raw): Result<Schedule> => {
  const compDate = text(raw, "compDate", "Settings");
  if (!compDate.success) return fail(compDate.error);
  if (!DATE_PATTERN.test(compDate.data)) return fail(`Settings: compDate "${compDate.data}" must be YYYY-MM-DD`);
  const timeZone = text(raw, "timeZone", "Settings");
  if (!timeZone.success) return fail(timeZone.error);
  const teamSize = integer(raw, "teamSize", "Settings");
  if (!teamSize.success) return fail(teamSize.error);
  const divisions = decodeDivisions(raw);
  if (!divisions.success) return fail(divisions.error);
  const signupsOpen = boolean(raw, "signupsOpen", "Settings");
  if (!signupsOpen.success) return fail(signupsOpen.error);
  if (!Array.isArray(raw.events)) return fail("Events: must be a list");
  const decodedEvents = all(raw.events.map(decodeEvent));
  if (!decodedEvents.success) return fail(decodedEvents.error);
  return ok({
    compDate: compDate.data,
    timeZone: timeZone.data,
    teamSize: teamSize.data,
    divisions: divisions.data,
    signupsOpen: signupsOpen.data,
    events: decodedEvents.data,
  });
};

export const decodeSchedule = (value: unknown): Result<Schedule> => {
  if (!isRaw(value)) return fail("Schedule is not an object");
  const shape = decodeShape(value);
  if (!shape.success) return shape;
  const problems = validateSchedule(shape.data);
  return problems.length === 0 ? shape : fail(problems.join("; "));
};
