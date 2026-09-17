import { localToInstant } from "../core/comp-time";

const OVERRIDE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

type ReadNowOverrideOptions = {
  readonly search: string;
  readonly fallback: Date;
  readonly timeZone: string;
};

export const readNowOverride = ({ search, fallback, timeZone }: ReadNowOverrideOptions): Date => {
  const raw = new URLSearchParams(search).get("at");
  const match = raw ? OVERRIDE_PATTERN.exec(raw) : null;
  const [, date, hhmm] = match ?? [];
  if (!date || !hhmm) return fallback;
  return localToInstant({ date, hhmm, timeZone });
};
