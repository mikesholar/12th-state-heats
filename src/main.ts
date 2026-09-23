import "./styles.css";
import { resolveJudgeCode } from "./core/judge-codes";
import { chooseSchedule, jitter, reloadIntervalMs, sourceNotice, type LoadedSchedule } from "./core/load-schedule";
import type { Event, Schedule } from "./core/types";
import { judgeCodes, signupCode } from "./data/judge-codes";
import { sheetEndpoint } from "./data/sheet-endpoint";
import { snapshotSchedule } from "./data/snapshot";
import { startJudgePage } from "./ui/judge-page";
import { readJudgeCode } from "./ui/judge-route";
import { readNowOverride } from "./ui/now-override";
import { render } from "./ui/render";
import { renderHead } from "./ui/render-head";
import { renderInvalid } from "./ui/render-invalid";
import { fetchSchedule } from "./ui/schedule-client";
import { loadCachedSchedule, saveCachedSchedule } from "./ui/schedule-store";
import { startSignupPage } from "./ui/signup-page";
import { readSignupCode } from "./ui/signup-route";

const REFRESH_MS = 15_000;
const SPECTATOR_RELOAD = { open: 60_000, closed: 180_000 };
const SIGNUP_RELOAD = { open: 30_000, closed: 180_000 };

const nextReloadMs = (schedule: Schedule, intervals: { readonly open: number; readonly closed: number }): number =>
  jitter({ ms: reloadIntervalMs({ schedule, ...intervals }), random: Math.random() });

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const loadSchedule = async (): Promise<LoadedSchedule> => {
  const fetched = await fetchSchedule({ endpoint: sheetEndpoint, fetchFn: fetch });
  if (fetched.kind === "loaded") saveCachedSchedule(fetched.schedule);
  const cached = fetched.kind === "loaded" ? undefined : loadCachedSchedule();
  return chooseSchedule({ fetched, cached, snapshot: snapshotSchedule });
};

const clockFor = (schedule: Schedule): (() => Date) => {
  const previewOffsetMs =
    readNowOverride({ search: location.search, fallback: new Date(), timeZone: schedule.timeZone }).getTime() - Date.now();
  return () => new Date(Date.now() + previewOffsetMs);
};

const lastKnownSchedule = (): LoadedSchedule => {
  const cached = loadCachedSchedule();
  return cached ? { schedule: cached, source: "cached" } : { schedule: snapshotSchedule, source: "snapshot" };
};

const startSpectator = (): void => {
  let loaded = lastKnownSchedule();
  let awaitingFirstLoad = true;
  const now = clockFor(loaded.schedule);

  const draw = (): void => {
    render({
      root,
      schedule: loaded.schedule,
      now: now(),
      sourceNotice: awaitingFirstLoad ? undefined : sourceNotice(loaded),
    });
  };

  const reload = async (): Promise<void> => {
    loaded = await loadSchedule();
    awaitingFirstLoad = false;
    draw();
  };

  const reloadLater = (): void => {
    setTimeout(() => void reload().finally(reloadLater), nextReloadMs(loaded.schedule, SPECTATOR_RELOAD));
  };

  draw();
  root.querySelector(".heat.current, .heat.upcoming")?.scrollIntoView({ block: "start" });
  setInterval(draw, REFRESH_MS);
  void reload().finally(reloadLater);
};

type StartJudgeOptions = {
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
};

const startJudge = ({ schedule, event, lane }: StartJudgeOptions): void => {
  const page = startJudgePage({
    root,
    schedule,
    event,
    lane,
    endpoint: sheetEndpoint,
    now: clockFor(schedule),
    fetchFn: fetch,
    newClientId: () => crypto.randomUUID(),
  });
  setInterval(() => void page.tick(), REFRESH_MS);
  window.addEventListener("online", () => void page.tick());
};

const startSignup = (initial: LoadedSchedule): void => {
  const page = startSignupPage({ root, initial, loadSchedule, endpoint: sheetEndpoint, fetchFn: fetch });
  const refreshLater = (): void => {
    setTimeout(() => void page.refresh().finally(refreshLater), nextReloadMs(page.schedule(), SIGNUP_RELOAD));
  };
  refreshLater();
};

const route = (loaded: LoadedSchedule): void => {
  const { schedule } = loaded;
  const signup = readSignupCode(location.search);
  if (signup !== undefined) {
    if (signup === signupCode) startSignup(loaded);
    else renderInvalid({ root, hint: "Ask the organisers for the sign-up link." });
    return;
  }
  const code = readJudgeCode(location.search);
  const assignment = resolveJudgeCode({ table: judgeCodes, code });
  const laneEvent = assignment.kind === "lane" ? schedule.events.find((e) => e.number === assignment.event) : undefined;

  if (assignment.kind === "lane" && laneEvent && assignment.lane <= laneEvent.lanes)
    startJudge({ schedule, event: laneEvent, lane: assignment.lane });
  else if (assignment.kind === "head")
    renderHead({ root, schedule, table: judgeCodes, siteUrl: `${location.origin}${import.meta.env.BASE_URL}` });
  else renderInvalid({ root });
};

const renderLoadFailed = (): void => {
  root.innerHTML = `<main class="main"><p class="loading">Couldn't load the schedule — check your connection and reload.</p></main>`;
};

const hasCode = readSignupCode(location.search) !== undefined || readJudgeCode(location.search) !== undefined;
if (hasCode) {
  root.innerHTML = `<main class="main"><p class="loading">Loading schedule…</p></main>`;
  void loadSchedule().then(route).catch(renderLoadFailed);
} else {
  startSpectator();
}
