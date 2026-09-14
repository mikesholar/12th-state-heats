import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { JudgeAssignment, JudgeCodeTable } from "../src/core/judge-codes";
import { schedule } from "../src/data/schedule";

const OUTPUT = "src/data/judge-codes.ts";
const SITE = "https://mikesholar.github.io/12th-state-heats/";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 5;
const regenerate = process.argv.includes("--regenerate");

type Entry = { readonly code: string; readonly assignment: JudgeAssignment };

const assignmentKey = (a: JudgeAssignment): string => (a.kind === "head" ? "head" : `e${a.event}l${a.lane}`);

const randomCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const neededAssignments = (): readonly JudgeAssignment[] => [
  ...schedule.events.flatMap((event) =>
    [...new Set(event.heats.flatMap((heat) => heat.lanes.map((lane) => lane.lane)))]
      .sort((a, b) => a - b)
      .map((lane): JudgeAssignment => ({ kind: "lane", event: event.number, lane })),
  ),
  { kind: "head" },
];

const existingEntries = async (): Promise<readonly Entry[]> => {
  if (regenerate) return [];
  const module = await import("../src/data/judge-codes").catch((): { judgeCodes: JudgeCodeTable } => ({ judgeCodes: {} }));
  return Object.entries(module.judgeCodes).map(([code, assignment]) => ({ code, assignment }));
};

const withCodes = (assignments: readonly JudgeAssignment[], existing: readonly Entry[]): readonly Entry[] => {
  const existingCodes = existing.map((e) => e.code);
  return assignments.reduce<readonly Entry[]>((entries, assignment) => {
    const kept = existing.find((e) => assignmentKey(e.assignment) === assignmentKey(assignment));
    const taken = new Set([...existingCodes, ...entries.map((e) => e.code)]);
    const fresh = (): string => {
      const candidate = randomCode();
      return taken.has(candidate) ? fresh() : candidate;
    };
    return [...entries, kept ?? { code: fresh(), assignment }];
  }, []);
};

const entryLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `  "${code}": { kind: "head" },`
    : `  "${code}": { kind: "lane", event: ${assignment.event}, lane: ${assignment.lane} },`;

const fileSource = (entries: readonly Entry[]): string =>
  [
    `import type { JudgeCodeTable } from "../core/judge-codes";`,
    ``,
    `export const judgeCodes: JudgeCodeTable = {`,
    ...entries.map(entryLine),
    `};`,
    ``,
  ].join("\n");

const linkLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `HEAD JUDGE            ${SITE}?j=${code}`
    : `Event ${assignment.event}  Lane ${assignment.lane}       ${SITE}?j=${code}`;

const entries = withCodes(neededAssignments(), await existingEntries());
writeFileSync(OUTPUT, fileSource(entries));
console.log(entries.map(linkLine).join("\n"));
console.log(`\nWrote ${entries.length} codes to ${OUTPUT}`);
