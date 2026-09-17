import type { ScoringFormat } from "./types";
import { fail, ok, type Result } from "./result";

export type { Result } from "./result";

export type Score =
  | { readonly kind: "time"; readonly seconds: number }
  | { readonly kind: "rounds-reps"; readonly rounds: number; readonly reps: number };

export type ScoreKind = Score["kind"];

type ValidateScoreOptions = {
  readonly scoring: ScoringFormat;
  readonly capSeconds: number | undefined;
  readonly score: Score;
};

const SECONDS_PER_MINUTE = 60;

const formatSeconds = (seconds: number): string => {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainder = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const validateTime = (seconds: number, capSeconds: number | undefined): Result<Score> => {
  if (!Number.isInteger(seconds)) return fail("Time must be whole seconds");
  if (seconds <= 0) return fail("Enter a time");
  if (capSeconds !== undefined && seconds > capSeconds) {
    return fail(`Time can't exceed the ${formatSeconds(capSeconds)} cap — use Capped`);
  }
  return ok({ kind: "time", seconds });
};

const validateRoundsReps = (rounds: number, reps: number): Result<Score> => {
  if (!Number.isInteger(rounds) || !Number.isInteger(reps)) return fail("Rounds and reps must be whole numbers");
  if (rounds < 0 || reps < 0) return fail("Rounds and reps can't be negative");
  if (rounds === 0 && reps === 0) return fail("Enter at least one rep");
  return ok({ kind: "rounds-reps", rounds, reps });
};

export const validateScore = ({ scoring, capSeconds, score }: ValidateScoreOptions): Result<Score> => {
  if (score.kind === "time") {
    if (scoring === "rounds-reps") return fail("This event is scored in rounds and reps");
    return validateTime(score.seconds, capSeconds);
  }
  return validateRoundsReps(score.rounds, score.reps);
};

export const formatScore = (score: Score): string =>
  score.kind === "time" ? formatSeconds(score.seconds) : `${score.rounds} + ${score.reps}`;
