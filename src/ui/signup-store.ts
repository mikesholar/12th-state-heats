import { normaliseEmail, type ClaimDraft } from "../core/signup";

const EMAIL_KEY = "signup:email";
const LAST_CLAIM_KEY = "signup:last";

const readRaw = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

const writeRaw = (key: string, value: string | undefined): void => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
};

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

const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const loadSignupEmail = (): string | undefined => readRaw(EMAIL_KEY);

export const saveSignupEmail = (email: string | undefined): void =>
  writeRaw(EMAIL_KEY, email === undefined ? undefined : normaliseEmail(email));

export const loadLastClaim = (): ClaimDraft | undefined => {
  const raw = readRaw(LAST_CLAIM_KEY);
  if (raw === undefined) return undefined;
  const parsed = parse(raw);
  return isClaimDraft(parsed) ? parsed : undefined;
};

export const saveLastClaim = (draft: ClaimDraft): void => writeRaw(LAST_CLAIM_KEY, JSON.stringify(draft));
