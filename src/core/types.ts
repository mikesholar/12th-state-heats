export type Lane = {
  readonly lane: number;
  readonly team: string;
  readonly athletes: string;
  readonly division: string;
};

export type Heat = {
  readonly number: number;
  readonly start: string;
  readonly end: string;
  readonly lanes: readonly Lane[];
};

export type ScoringFormat = "time-or-rounds" | "rounds-reps";

export type Event = {
  readonly number: number;
  readonly title: string;
  readonly format: string;
  readonly scoring: ScoringFormat;
  readonly capSeconds?: number;
  readonly rx: string;
  readonly scaled: string;
  readonly heats: readonly Heat[];
};

export type Schedule = {
  readonly compDate: string;
  readonly timeZone: string;
  readonly events: readonly Event[];
};
