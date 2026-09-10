import { localToInstant } from "../core/comp-time";
import { schedule } from "../data/schedule";

const OVERRIDE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export const readNowOverride = (search: string, fallback: Date): Date => {
  const raw = new URLSearchParams(search).get("at");
  const match = raw ? OVERRIDE_PATTERN.exec(raw) : null;
  const [, date, hhmm] = match ?? [];
  if (!date || !hhmm) return fallback;
  return localToInstant({ date, hhmm, timeZone: schedule.timeZone });
};
