import type { Event, Heat, Schedule } from "./types";

const heatLabel = (event: Event, heat: Heat): string => `Event ${event.number} Heat ${heat.number}`;

const duplicateLaneErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane, index) => heat.lanes.findIndex((other) => other.lane === lane.lane) !== index)
    .map((lane) => `${heatLabel(event, heat)}: lane ${lane.lane} is assigned to more than one team`);

const laneRangeErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane) => lane.lane < 1 || lane.lane > event.lanes)
    .map((lane) => `${heatLabel(event, heat)}: lane ${lane.lane} is outside 1–${event.lanes}`);

const divisionErrors = (schedule: Schedule, event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane) => !schedule.divisions.includes(lane.division))
    .map(
      (lane) =>
        `${heatLabel(event, heat)}: lane ${lane.lane} division "${lane.division}" is not one of ${schedule.divisions.join(", ")}`,
    );

const heatTimeErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.end > heat.start ? [] : [`${heatLabel(event, heat)}: end ${heat.end} is not after start ${heat.start}`];

const blockingHeat = (earlier: readonly Heat[], heat: Heat): Heat | undefined =>
  [...earlier].filter((other) => other.end > heat.start).sort((a, b) => b.end.localeCompare(a.end))[0];

const overlapErrors = (event: Event): readonly string[] => {
  const byStart = [...event.heats].sort((a, b) => a.start.localeCompare(b.start));
  return byStart.flatMap((heat, index) => {
    const blocking = blockingHeat(byStart.slice(0, index), heat);
    return blocking ? [`${heatLabel(event, heat)}: starts ${heat.start}, overlaps Heat ${blocking.number} ending ${blocking.end}`] : [];
  });
};

const duplicateHeatErrors = (event: Event): readonly string[] =>
  event.heats
    .filter((heat, index) => event.heats.findIndex((other) => other.number === heat.number) !== index)
    .map((heat) => `Event ${event.number}: Heat ${heat.number} appears more than once`);

const duplicateEventErrors = (schedule: Schedule): readonly string[] =>
  schedule.events
    .filter((event, index) => schedule.events.findIndex((other) => other.number === event.number) !== index)
    .map((event) => `Event ${event.number} appears more than once`);

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

const hasDivisions = (schedule: Schedule): boolean => schedule.divisions.length > 0;

const settingsErrors = (schedule: Schedule): readonly string[] => [
  ...(schedule.teamSize < 1 ? ["teamSize must be at least 1"] : []),
  ...(hasDivisions(schedule) ? [] : ["divisions must list at least one division"]),
  ...(schedule.events.length === 0 ? ["Events: must list at least one event"] : []),
];

const laneCountErrors = (event: Event): readonly string[] =>
  event.lanes < 1 ? [`Event ${event.number}: lanes must be at least 1`] : [];

const heatErrors = (schedule: Schedule, event: Event, heat: Heat): readonly string[] => [
  ...duplicateLaneErrors(event, heat),
  ...laneRangeErrors(event, heat),
  ...(hasDivisions(schedule) ? divisionErrors(schedule, event, heat) : []),
  ...heatTimeErrors(event, heat),
];

export const validateSchedule = (schedule: Schedule): readonly string[] => [
  ...settingsErrors(schedule),
  ...duplicateEventErrors(schedule),
  ...schedule.events.flatMap((event) => event.heats.flatMap((heat) => heatErrors(schedule, event, heat))),
  ...schedule.events.flatMap(overlapErrors),
  ...schedule.events.flatMap(duplicateHeatErrors),
  ...schedule.events.flatMap(laneCountErrors),
  ...schedule.events.flatMap(scoringErrors),
  ...schedule.events.flatMap(noHeatErrors),
];
