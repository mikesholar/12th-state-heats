import { fail, ok, type Result } from "./result";
import type { Event, Lane } from "./types";

export type SlotKey = {
  readonly event: number;
  readonly heat: number;
  readonly lane: number;
};

export type ClaimDraft = {
  readonly team: string;
  readonly athletes: readonly string[];
  readonly division: string;
};

export type ClaimFields = {
  readonly team: string;
  readonly athletes: string;
  readonly division: string;
};

export type ClaimRequest = SlotKey & ClaimFields & { readonly action: "claim"; readonly email: string };

export type ReleaseRequest = SlotKey & { readonly action: "release"; readonly email: string };

type ValidateClaimOptions = {
  readonly draft: ClaimDraft;
  readonly teamSize: number;
  readonly divisions: readonly string[];
};

const ATHLETE_SEPARATOR = " + ";

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export const emptyDraft = (teamSize: number): ClaimDraft => ({
  team: "",
  athletes: Array.from({ length: teamSize }, () => ""),
  division: "",
});

export const validateClaim = ({ draft, teamSize, divisions }: ValidateClaimOptions): Result<ClaimFields> => {
  const names = draft.athletes.slice(0, teamSize).map((name) => name.trim());
  const team = draft.team.trim();
  if (names.length < teamSize || names.some((name) => name === "")) {
    return fail(teamSize === 1 ? "Enter your name" : "Enter a name for every athlete");
  }
  if (teamSize > 1 && team === "") return fail("Enter a team name");
  if (!divisions.includes(draft.division)) return fail("Pick a division");
  return ok({
    team: teamSize === 1 ? (names[0] ?? "") : team,
    athletes: names.join(ATHLETE_SEPARATOR),
    division: draft.division,
  });
};

type BuildClaimOptions = { readonly slot: SlotKey; readonly email: string; readonly fields: ClaimFields };

export const buildClaim = ({ slot, email, fields }: BuildClaimOptions): ClaimRequest => ({
  action: "claim",
  ...slot,
  email: normaliseEmail(email),
  ...fields,
});

type BuildReleaseOptions = { readonly slot: SlotKey; readonly email: string };

export const buildRelease = ({ slot, email }: BuildReleaseOptions): ReleaseRequest => ({
  action: "release",
  ...slot,
  email: normaliseEmail(email),
});

type IsMineOptions = { readonly lane: Lane; readonly email: string };

export const isMine = ({ lane, email }: IsMineOptions): boolean =>
  lane.email !== undefined && normaliseEmail(lane.email) === normaliseEmail(email);

type MySlotInOptions = { readonly event: Event; readonly email: string };

export const mySlotIn = ({ event, email }: MySlotInOptions): { readonly heat: number; readonly lane: number } | undefined =>
  event.heats.flatMap((heat) => heat.lanes.filter((lane) => isMine({ lane, email })).map((lane) => ({ heat: heat.number, lane: lane.lane })))[0];
