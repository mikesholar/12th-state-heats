import type { Submission } from "../core/submission";

const NAME_KEY = "judge:name";
const QUEUE_KEY = "judge:queue";

type LaneKey = { readonly event: number; readonly lane: number };

const sentKey = ({ event, lane }: LaneKey): string => `judge:sent:${event}:${lane}`;

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

const readJson = <T>(key: string, isValid: (value: unknown) => value is T): T | undefined => {
  const raw = readRaw(key);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isNumberArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

const isSubmissionArray = (value: unknown): value is readonly Submission[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "object" && item !== null && "clientId" in item && typeof item.clientId === "string");

export const loadJudgeName = (): string | undefined => readRaw(NAME_KEY);

export const saveJudgeName = (name: string | undefined): void => writeRaw(NAME_KEY, name);

export const loadSentHeats = (key: LaneKey): readonly number[] => readJson(sentKey(key), isNumberArray) ?? [];

export const markHeatSent = ({ event, lane, heat }: LaneKey & { readonly heat: number }): void => {
  const current = loadSentHeats({ event, lane });
  const next = current.includes(heat) ? current : [...current, heat].sort((a, b) => a - b);
  writeRaw(sentKey({ event, lane }), JSON.stringify(next));
};

export const loadQueue = (): readonly Submission[] => readJson(QUEUE_KEY, isSubmissionArray) ?? [];

export const saveQueue = (queue: readonly Submission[]): void => writeRaw(QUEUE_KEY, JSON.stringify(queue));
