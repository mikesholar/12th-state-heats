import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";

const KEY = "schedule:cache";

const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const loadCachedSchedule = (): Schedule | undefined => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const decoded = decodeSchedule(parse(raw));
    return decoded.success ? decoded.data : undefined;
  } catch {
    return undefined;
  }
};

export const saveCachedSchedule = (schedule: Schedule): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(schedule));
  } catch {
    return;
  }
};
