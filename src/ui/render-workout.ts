import type { Event } from "../core/types";
import { esc } from "./html";

type WorkoutVersion = "rx" | "scaled";

const versionForDivision = (division: string | undefined): WorkoutVersion | undefined => {
  if (division && /\bscaled\b/i.test(division)) return "scaled";
  if (division && /\brx\b/i.test(division)) return "rx";
  return undefined;
};

type WodLineOptions = { readonly label: string; readonly text: string; readonly theirs: boolean };

const wodLineHtml = ({ label, text, theirs }: WodLineOptions): string =>
  `<div class="event-wod${theirs ? " wod-theirs" : ""}"${theirs ? ' aria-current="true"' : ""}><span class="wod-label">${label}</span> ${esc(text)}</div>`;

type WorkoutHtmlOptions = { readonly event: Event; readonly division?: string };

export const workoutHtml = ({ event, division }: WorkoutHtmlOptions): string => {
  const version = versionForDivision(division);
  return `
  <section class="workout-card" data-testid="workout">
    <div class="event-format">${esc(event.format)}</div>
    ${wodLineHtml({ label: "RX", text: event.rx, theirs: version === "rx" })}
    ${wodLineHtml({ label: "Scaled", text: event.scaled, theirs: version === "scaled" })}
  </section>`;
};
