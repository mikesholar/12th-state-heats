import "./styles.css";
import { schedule } from "./data/schedule";
import { readNowOverride } from "./ui/now-override";
import { render } from "./ui/render";
import { loadTeam, saveTeam } from "./ui/team-store";

const REFRESH_MS = 15_000;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const previewOffsetMs = readNowOverride(location.search, new Date()).getTime() - Date.now();
const now = (): Date => new Date(Date.now() + previewOffsetMs);

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
