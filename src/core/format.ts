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

const DAY_MS = 86_400_000;

const noonOf = (date: string): Date => new Date(`${date}T12:00:00Z`);

const dayPart = (date: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(noonOf(date));

export const formatWeekday = (date: string): string => dayPart(date, { weekday: "short" });

export const formatDay = (date: string): string =>
  `${formatWeekday(date)} ${dayPart(date, { month: "short", day: "numeric" })}`;

const isNextDay = (earlier: string, later: string): boolean => noonOf(later).getTime() - noonOf(earlier).getTime() === DAY_MS;

const areConsecutive = (days: readonly string[]): boolean =>
  days.every((day, i) => i === 0 || isNextDay(days[i - 1] ?? day, day));

export const formatDayList = (days: readonly string[]): string => {
  const labels = days.map(formatDay);
  const first = labels[0] ?? "";
  const last = labels[labels.length - 1] ?? "";
  if (labels.length <= 1) return first;
  if (areConsecutive(days)) return `${first} – ${last}`;
  return `${labels.slice(0, -1).join(", ")} & ${last}`;
};
