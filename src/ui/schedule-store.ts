import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";
import { parseJson, readRaw, writeRaw } from "./storage";

const KEY = "schedule:cache";

export const loadCachedSchedule = (): Schedule | undefined => {
  const raw = readRaw(KEY);
  if (raw === undefined) return undefined;
  const decoded = decodeSchedule(parseJson(raw));
  return decoded.success ? decoded.data : undefined;
};

export const saveCachedSchedule = (schedule: Schedule): void => writeRaw(KEY, JSON.stringify(schedule));
