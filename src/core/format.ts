const MINUTES_PER_HOUR = 60;
const HOURS_ON_CLOCK = 12;

export const formatClock = (hhmm: string): string => {
  const [hourPart = "0", minutePart = "00"] = hhmm.split(":");
  const hour24 = Number(hourPart);
  const hour12 = hour24 % HOURS_ON_CLOCK === 0 ? HOURS_ON_CLOCK : hour24 % HOURS_ON_CLOCK;
  return `${hour12}:${minutePart}`;
};

export const formatRange = (start: string, end: string): string =>
  `${formatClock(start)} – ${formatClock(end)}`;

export const formatCountdown = (minutes: number): string => {
  if (minutes <= 0) return "starting now";
  if (minutes < MINUTES_PER_HOUR) return `in ${minutes} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;
  return remainder === 0 ? `in ${hours} h` : `in ${hours} h ${remainder} min`;
};
