export type JudgeAssignment =
  | { readonly kind: "lane"; readonly event: number; readonly lane: number }
  | { readonly kind: "head" };

export type JudgeCodeTable = Readonly<Record<string, JudgeAssignment>>;

export type JudgeResolution = JudgeAssignment | { readonly kind: "unknown" };

type ResolveJudgeCodeOptions = {
  readonly table: JudgeCodeTable;
  readonly code: string | undefined;
};

export const resolveJudgeCode = ({ table, code }: ResolveJudgeCodeOptions): JudgeResolution => {
  const normalised = code?.trim().toLowerCase();
  if (!normalised) return { kind: "unknown" };
  return table[normalised] ?? { kind: "unknown" };
};
