import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { JudgeAssignment, JudgeCodeTable } from "../src/core/judge-codes";
import { snapshotSchedule } from "../src/data/snapshot";

const OUTPUT = "src/data/judge-codes.ts";
const SITE = "https://mikesholar.github.io/12th-state-heats/";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 5;
const GRID_EVENTS = 6;
const GRID_LANES = 12;
const regenerate = process.argv.includes("--regenerate");

type Entry = { readonly code: string; readonly assignment: JudgeAssignment };

type Existing = { readonly entries: readonly Entry[]; readonly signupCode: string | undefined };

const assignmentKey = (a: JudgeAssignment): string => (a.kind === "head" ? "head" : `e${a.event}l${a.lane}`);

const randomCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const range = (count: number): readonly number[] => Array.from({ length: count }, (_, i) => i + 1);

const neededAssignments = (): readonly JudgeAssignment[] => [
  ...range(GRID_EVENTS).flatMap((event) => range(GRID_LANES).map((lane): JudgeAssignment => ({ kind: "lane", event, lane }))),
  { kind: "head" },
];

const existing = async (): Promise<Existing> => {
  if (regenerate) return { entries: [], signupCode: undefined };
  const module = await import("../src/data/judge-codes").catch(
    (): { judgeCodes: JudgeCodeTable; signupCode?: string } => ({ judgeCodes: {} }),
  );
  return {
    entries: Object.entries(module.judgeCodes).map(([code, assignment]) => ({ code, assignment })),
    signupCode: module.signupCode,
  };
};

const freshCode = (taken: ReadonlySet<string>): string => {
  const candidate = randomCode();
  return taken.has(candidate) ? freshCode(taken) : candidate;
};

const withCodes = (assignments: readonly JudgeAssignment[], kept: readonly Entry[], reserved: readonly string[]): readonly Entry[] => {
  const reservedCodes = [...reserved, ...kept.map((e) => e.code)];
  return assignments.reduce<readonly Entry[]>((entries, assignment) => {
    const existingEntry = kept.find((e) => assignmentKey(e.assignment) === assignmentKey(assignment));
    const taken = new Set([...reservedCodes, ...entries.map((e) => e.code)]);
    return [...entries, existingEntry ?? { code: freshCode(taken), assignment }];
  }, []);
};

const entryLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `  "${code}": { kind: "head" },`
    : `  "${code}": { kind: "lane", event: ${assignment.event}, lane: ${assignment.lane} },`;

const fileSource = (entries: readonly Entry[], signupCode: string): string =>
  [
    `import type { JudgeCodeTable } from "../core/judge-codes";`,
    ``,
    `export const judgeCodes: JudgeCodeTable = {`,
    ...entries.map(entryLine),
    `};`,
    ``,
    `export const signupCode = "${signupCode}";`,
    ``,
  ].join("\n");

const inSnapshot = (assignment: JudgeAssignment): boolean =>
  assignment.kind === "head" ||
  snapshotSchedule.events.some((event) => event.number === assignment.event && assignment.lane <= event.lanes);

const linkLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `HEAD JUDGE            ${SITE}?j=${code}`
    : `Event ${assignment.event}  Lane ${String(assignment.lane).padStart(2)}      ${SITE}?j=${code}`;

const previous = await existing();
const signupCode = previous.signupCode ?? freshCode(new Set(previous.entries.map((e) => e.code)));
const entries = withCodes(neededAssignments(), previous.entries, [signupCode]);
writeFileSync(OUTPUT, fileSource(entries, signupCode));

const used = entries.filter((e) => inSnapshot(e.assignment));
console.log(used.map(linkLine).join("\n"));
console.log(`SIGN-UP               ${SITE}?s=${signupCode}`);
console.log(`\nWrote ${entries.length} codes to ${OUTPUT} (${entries.length - used.length} spare for events/lanes not in the snapshot)`);
