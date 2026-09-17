import { fail, ok, type Result } from "./result";
import type { Division, Event, Heat, Lane, Schedule, ScoringFormat } from "./types";
import { validateSchedule } from "./validate-schedule";

type Raw = Readonly<Record<string, unknown>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LANE_LABEL = "Lane";
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const HOURS_ON_CLOCK = 24;
const MINUTES_PER_HOUR = 60;
const INTEGER_PATTERN = /^-?\d+$/;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

const trimmed = (value: unknown): string => shown(value).trim();

const isRealDate = (value: string): boolean => {
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
  } catch {
    return false;
  }
};

const isTimeZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

const text = (raw: Raw, key: string, where: string): Result<string> => {
  const value = trimmed(raw[key]);
  return value === "" ? fail(`${where}: ${key} is missing`) : ok(value);
};

const optionalText = (raw: Raw, key: string): string => trimmed(raw[key]);

const integer = (raw: Raw, key: string, where: string): Result<number> => {
  const value = trimmed(raw[key]);
  if (value === "") return fail(`${where}: ${key} is missing`);
  if (!INTEGER_PATTERN.test(value)) return fail(`${where}: ${key} "${shown(raw[key])}" must be a whole number`);
  return ok(Number(value));
};

const optionalInteger = (raw: Raw, key: string, where: string): Result<number | undefined> =>
  trimmed(raw[key]) === "" ? ok(undefined) : integer(raw, key, where);

const boolean = (raw: Raw, key: string, where: string): Result<boolean> => {
  const value = raw[key];
  if (typeof value === "boolean") return ok(value);
  const upper = trimmed(value).toUpperCase();
  if (upper === "TRUE") return ok(true);
  if (upper === "FALSE") return ok(false);
  return fail(`${where}: ${key} "${shown(value)}" must be TRUE or FALSE`);
};

const list = (raw: Raw, key: string, where: string): Result<readonly unknown[]> =>
  Array.isArray(raw[key]) ? ok(raw[key]) : fail(`${where}: ${key} must be a list`);

const all = <T>(results: readonly Result<T>[]): Result<readonly T[]> => {
  const failure = results.find((result) => !result.success);
  if (failure && !failure.success) return failure;
  return ok(results.flatMap((result) => (result.success ? [result.data] : [])));
};

const normalisedClock = (value: string): string | undefined => {
  const [, hours = "", minutes = ""] = TIME_PATTERN.exec(value) ?? [];
  if (hours === "" || Number(hours) >= HOURS_ON_CLOCK || Number(minutes) >= MINUTES_PER_HOUR) return undefined;
  return `${hours.padStart(2, "0")}:${minutes}`;
};

const clock = (raw: Raw, key: string, where: string): Result<string> => {
  const value = text(raw, key, where);
  if (!value.success) return value;
  const normalised = normalisedClock(value.data);
  return normalised === undefined ? fail(`${where}: ${key} "${value.data}" must be HH:MM`) : ok(normalised);
};

const scoringFormat = (raw: Raw, where: string): Result<ScoringFormat> => {
  const value = trimmed(raw.scoring);
  if (value === "time-or-rounds" || value === "rounds-reps") return ok(value);
  return fail(`${where}: scoring "${shown(raw.scoring)}" must be time-or-rounds or rounds-reps`);
};

const decodeLane = (where: string) => (value: unknown): Result<Lane> => {
  if (!isRaw(value)) return fail(`Slots: ${where}: a lane entry is not an object`);
  const lane = integer(value, "lane", `Slots: ${where}`);
  if (!lane.success) return lane;
  const laneWhere = `Slots: ${where} lane ${lane.data}`;
  const team = text(value, "team", laneWhere);
  if (!team.success) return team;
  const athletes = text(value, "athletes", laneWhere);
  if (!athletes.success) return athletes;
  const division = text(value, "division", laneWhere);
  if (!division.success) return division;
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
  if (!number.success) return number;
  const where = `Event ${eventNumber} Heat ${number.data}`;
  const start = clock(value, "start", `Heats: ${where}`);
  if (!start.success) return start;
  const end = clock(value, "end", `Heats: ${where}`);
  if (!end.success) return end;
  const lanes = list(value, "lanes", `Heats: ${where}`);
  if (!lanes.success) return lanes;
  const decodedLanes = all(lanes.data.map(decodeLane(where)));
  if (!decodedLanes.success) return decodedLanes;
  return ok({ number: number.data, start: start.data, end: end.data, lanes: decodedLanes.data });
};

const decodeEvent = (value: unknown): Result<Event> => {
  if (!isRaw(value)) return fail("Events: an event entry is not an object");
  const number = integer(value, "number", "Events");
  if (!number.success) return number;
  const where = `Events: Event ${number.data}`;
  const title = text(value, "title", where);
  if (!title.success) return title;
  const scoring = scoringFormat(value, where);
  if (!scoring.success) return scoring;
  const capSeconds = optionalInteger(value, "capSeconds", where);
  if (!capSeconds.success) return capSeconds;
  const lanes = integer(value, "lanes", where);
  if (!lanes.success) return lanes;
  const heats = list(value, "heats", where);
  if (!heats.success) return heats;
  const decodedHeats = all(heats.data.map(decodeHeat(number.data)));
  if (!decodedHeats.success) return decodedHeats;
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

const decodeDivision = (value: unknown): Result<Division> => {
  if (!isRaw(value)) return fail("Divisions: a division entry is not an object");
  const name = text(value, "name", "Divisions");
  if (!name.success) return name;
  const teamSize = integer(value, "teamSize", `Divisions: "${name.data}"`);
  if (!teamSize.success) return teamSize;
  return ok({ name: name.data, teamSize: teamSize.data });
};

const decodeDivisions = (raw: Raw): Result<readonly Division[]> => {
  if (!Array.isArray(raw.divisions)) return fail("Divisions: must be a list");
  return all(raw.divisions.map(decodeDivision));
};

const decodeShape = (raw: Raw): Result<Schedule> => {
  const compDate = text(raw, "compDate", "Settings");
  if (!compDate.success) return compDate;
  if (!DATE_PATTERN.test(compDate.data)) return fail(`Settings: compDate "${compDate.data}" must be YYYY-MM-DD`);
  if (!isRealDate(compDate.data)) return fail(`Settings: compDate "${compDate.data}" is not a real date`);
  const timeZone = text(raw, "timeZone", "Settings");
  if (!timeZone.success) return timeZone;
  if (!isTimeZone(timeZone.data)) return fail(`Settings: timeZone "${timeZone.data}" is not a known time zone (e.g. America/New_York)`);
  const divisions = decodeDivisions(raw);
  if (!divisions.success) return divisions;
  const laneLabel = optionalText(raw, "laneLabel") || DEFAULT_LANE_LABEL;
  const signupsOpen = boolean(raw, "signupsOpen", "Settings");
  if (!signupsOpen.success) return signupsOpen;
  if (!Array.isArray(raw.events)) return fail("Events: must be a list");
  const decodedEvents = all(raw.events.map(decodeEvent));
  if (!decodedEvents.success) return decodedEvents;
  return ok({
    compDate: compDate.data,
    timeZone: timeZone.data,
    divisions: divisions.data,
    laneLabel,
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
