import type { Event } from "../core/types";
import { esc } from "./html";

type WorkoutVersion = "rx" | "intermediate" | "scaled";

const versionForDivision = (division: string | undefined): WorkoutVersion | undefined => {
  if (division && /\bscaled\b/i.test(division)) return "scaled";
  if (division && /\bintermediate\b/i.test(division)) return "intermediate";
  if (division && /\brx\b/i.test(division)) return "rx";
  return undefined;
};

type WodLineOptions = { readonly label: string; readonly text: string; readonly theirs: boolean };

const wodLineHtml = ({ label, text, theirs }: WodLineOptions): string =>
  `<div class="event-wod${theirs ? " wod-theirs" : ""}"${theirs ? ' aria-current="true"' : ""}><span class="wod-label">${label}</span> ${esc(text)}</div>`;

export const eventWodLinesHtml = (event: Event): string => `
      <div class="event-wod"><span class="wod-label">RX</span> ${esc(event.rx)}</div>
      ${event.intermediate ? `<div class="event-wod"><span class="wod-label">Intermediate</span> ${esc(event.intermediate)}</div>` : ""}
      <div class="event-wod"><span class="wod-label">Scaled</span> ${esc(event.scaled)}</div>`;

type WorkoutHtmlOptions = { readonly event: Event; readonly division?: string };

export const workoutHtml = ({ event, division }: WorkoutHtmlOptions): string => {
  const version = versionForDivision(division);
  return `
  <section class="workout-card" data-testid="workout">
    <div class="event-format">${esc(event.format)}</div>
    ${wodLineHtml({ label: "RX", text: event.rx, theirs: version === "rx" })}
    ${event.intermediate ? wodLineHtml({ label: "Intermediate", text: event.intermediate, theirs: version === "intermediate" }) : ""}
    ${wodLineHtml({ label: "Scaled", text: event.scaled, theirs: version === "scaled" })}
  </section>`;
};
