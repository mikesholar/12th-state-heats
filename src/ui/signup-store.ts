import { normaliseEmail, type ClaimDraft } from "../core/signup";
import { readJson, readRaw, writeRaw } from "./storage";

const EMAIL_KEY = "signup:email";
const LAST_CLAIM_KEY = "signup:last";

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isClaimDraft = (value: unknown): value is ClaimDraft =>
  typeof value === "object" &&
  value !== null &&
  "team" in value &&
  typeof value.team === "string" &&
  "athletes" in value &&
  isStringArray(value.athletes) &&
  "division" in value &&
  typeof value.division === "string";

export const loadSignupEmail = (): string | undefined => readRaw(EMAIL_KEY);

export const saveSignupEmail = (email: string | undefined): void =>
  writeRaw(EMAIL_KEY, email === undefined ? undefined : normaliseEmail(email));

export const loadLastClaim = (): ClaimDraft | undefined => readJson(LAST_CLAIM_KEY, isClaimDraft);

export const saveLastClaim = (draft: ClaimDraft): void => writeRaw(LAST_CLAIM_KEY, JSON.stringify(draft));
