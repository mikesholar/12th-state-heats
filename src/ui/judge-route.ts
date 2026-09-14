export const readJudgeCode = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get("j");
  return value ? value : undefined;
};
