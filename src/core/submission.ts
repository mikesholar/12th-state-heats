import type { Score, ScoreKind } from "./score";
import type { Event, Heat, Lane } from "./types";

export type Submission = {
  readonly clientId: string;
  readonly submittedAt: string;
  readonly judge: string;
  readonly event: number;
  readonly heat: number;
  readonly lane: number;
  readonly team: string;
  readonly division: string;
  readonly scoreKind: ScoreKind;
  readonly seconds: number | "";
  readonly rounds: number | "";
  readonly reps: number | "";
};

type BuildSubmissionOptions = {
  readonly judge: string;
  readonly event: Event;
  readonly heat: Heat;
  readonly lane: Lane;
  readonly score: Score;
  readonly now: Date;
  readonly clientId: string;
};

export const buildSubmission = ({ judge, event, heat, lane, score, now, clientId }: BuildSubmissionOptions): Submission => ({
  clientId,
  submittedAt: now.toISOString(),
  judge,
  event: event.number,
  heat: heat.number,
  lane: lane.lane,
  team: lane.team,
  division: lane.division,
  scoreKind: score.kind,
  seconds: score.kind === "time" ? score.seconds : "",
  rounds: score.kind === "rounds-reps" ? score.rounds : "",
  reps: score.kind === "rounds-reps" ? score.reps : "",
});
