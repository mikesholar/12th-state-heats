import "./styles.css";
import { resolveJudgeCode } from "./core/judge-codes";
import { chooseSchedule, sourceNotice, type LoadedSchedule } from "./core/load-schedule";
import type { Event, Schedule } from "./core/types";
import { judgeCodes } from "./data/judge-codes";
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
import { loadTeam, saveTeam } from "./ui/team-store";

const REFRESH_MS = 15_000;
const RELOAD_SCHEDULE_MS = 60_000;

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

const startSpectator = (initial: LoadedSchedule): void => {
  let loaded = initial;
  const now = clockFor(initial.schedule);

  const draw = (selectedTeam: string | undefined): void => {
    render({
      root,
      schedule: loaded.schedule,
      now: now(),
      selectedTeam,
      onTeamChange: (team) => {
        saveTeam(team);
        draw(team);
      },
      sourceNotice: sourceNotice(loaded),
    });
  };

  draw(loadTeam());
  root.querySelector(".heat.current, .heat.upcoming")?.scrollIntoView({ block: "start" });
  setInterval(() => draw(loadTeam()), REFRESH_MS);
  setInterval(() => {
    void loadSchedule().then((next) => {
      loaded = next;
      draw(loadTeam());
    });
  }, RELOAD_SCHEDULE_MS);
};

const startJudge = (schedule: Schedule, event: Event, lane: number): void => {
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

const route = (loaded: LoadedSchedule): void => {
  const { schedule } = loaded;
  const code = readJudgeCode(location.search);
  const assignment = resolveJudgeCode({ table: judgeCodes, code });
  const laneEvent = assignment.kind === "lane" ? schedule.events.find((e) => e.number === assignment.event) : undefined;

  if (code === undefined) startSpectator(loaded);
  else if (assignment.kind === "lane" && laneEvent && assignment.lane <= laneEvent.lanes) startJudge(schedule, laneEvent, assignment.lane);
  else if (assignment.kind === "head")
    void renderHead({ root, schedule, table: judgeCodes, siteUrl: `${location.origin}${import.meta.env.BASE_URL}` }).catch(() =>
      renderInvalid({ root }),
    );
  else renderInvalid({ root });
};

root.innerHTML = `<main class="main"><p class="loading">Loading schedule…</p></main>`;
void loadSchedule().then(route);
