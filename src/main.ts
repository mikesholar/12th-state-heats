import "./styles.css";
import { resolveJudgeCode } from "./core/judge-codes";
import type { Event } from "./core/types";
import { judgeCodes } from "./data/judge-codes";
import { schedule } from "./data/schedule";
import { scoringEndpoint } from "./data/scoring-endpoint";
import { startJudgePage } from "./ui/judge-page";
import { readJudgeCode } from "./ui/judge-route";
import { readNowOverride } from "./ui/now-override";
import { render } from "./ui/render";
import { renderHead } from "./ui/render-head";
import { renderInvalid } from "./ui/render-invalid";
import { loadTeam, saveTeam } from "./ui/team-store";

const REFRESH_MS = 15_000;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const previewOffsetMs = readNowOverride(location.search, new Date()).getTime() - Date.now();
const now = (): Date => new Date(Date.now() + previewOffsetMs);

const startSpectator = (): void => {
  const draw = (selectedTeam: string | undefined): void => {
    render({
      root,
      schedule,
      now: now(),
      selectedTeam,
      onTeamChange: (team) => {
        saveTeam(team);
        draw(team);
      },
    });
  };

  draw(loadTeam());
  root.querySelector(".heat.current, .heat.upcoming")?.scrollIntoView({ block: "start" });
  setInterval(() => draw(loadTeam()), REFRESH_MS);
};

const startJudge = (event: Event, lane: number): void => {
  const page = startJudgePage({
    root,
    schedule,
    event,
    lane,
    endpoint: scoringEndpoint,
    now,
    fetchFn: fetch,
    newClientId: () => crypto.randomUUID(),
  });
  setInterval(() => void page.tick(), REFRESH_MS);
  window.addEventListener("online", () => void page.tick());
};

const code = readJudgeCode(location.search);
const assignment = resolveJudgeCode({ table: judgeCodes, code });
const laneEvent = assignment.kind === "lane" ? schedule.events.find((e) => e.number === assignment.event) : undefined;

if (code === undefined) startSpectator();
else if (assignment.kind === "lane" && laneEvent) startJudge(laneEvent, assignment.lane);
else if (assignment.kind === "head") void renderHead({ root, schedule, table: judgeCodes, siteUrl: `${location.origin}${import.meta.env.BASE_URL}` });
else renderInvalid({ root });
