import type { Event, Heat, Schedule } from "./types";

const MIN_LANES = 7;
const MAX_LANES = 8;

const heatLabel = (event: Event, heat: Heat): string => `Event ${event.number} Heat ${heat.number}`;

const duplicateLaneErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane, index) => heat.lanes.findIndex((other) => other.lane === lane.lane) !== index)
    .map((lane) => `${heatLabel(event, heat)}: lane ${lane.lane} is assigned to more than one team`);

const laneCountErrors = (event: Event, heat: Heat): readonly string[] => {
  const count = heat.lanes.length;
  if (count >= MIN_LANES && count <= MAX_LANES) return [];
  return [`${heatLabel(event, heat)}: has ${count} lanes, expected ${MIN_LANES}–${MAX_LANES}`];
};

const overlapErrors = (event: Event): readonly string[] =>
  event.heats.flatMap((heat, index) => {
    const previous = event.heats[index - 1];
    if (!previous || heat.start >= previous.end) return [];
    return [`${heatLabel(event, heat)}: starts ${heat.start}, overlaps Heat ${previous.number} ending ${previous.end}`];
  });

const teamsIn = (event: Event): ReadonlySet<string> =>
  new Set(event.heats.flatMap((heat) => heat.lanes.map((lane) => lane.team)));

const missingTeamErrors = (schedule: Schedule): readonly string[] => {
  const allTeams = new Set(schedule.events.flatMap((event) => [...teamsIn(event)]));
  return schedule.events.flatMap((event) => {
    const present = teamsIn(event);
    return [...allTeams]
      .filter((team) => !present.has(team))
      .map((team) => `"${team}" is missing from Event ${event.number}`);
  });
};

const noHeatErrors = (event: Event): readonly string[] =>
  event.heats.length === 0 ? [`Event ${event.number}: has no heats`] : [];

const scoringErrors = (event: Event): readonly string[] => {
  const hasCap = event.capSeconds !== undefined;
  if (event.scoring === "time-or-rounds" && !hasCap) {
    return [`Event ${event.number}: scoring is time-or-rounds but capSeconds is missing`];
  }
  if (event.scoring === "rounds-reps" && hasCap) {
    return [`Event ${event.number}: scoring is rounds-reps but capSeconds is set`];
  }
  return [];
};

export const validateSchedule = (schedule: Schedule): readonly string[] => [
  ...schedule.events.flatMap((event) =>
    event.heats.flatMap((heat) => [...duplicateLaneErrors(event, heat), ...laneCountErrors(event, heat)]),
  ),
  ...schedule.events.flatMap(overlapErrors),
  ...missingTeamErrors(schedule),
  ...schedule.events.flatMap(scoringErrors),
  ...schedule.events.flatMap(noHeatErrors),
];
