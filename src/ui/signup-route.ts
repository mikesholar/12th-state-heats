export const readSignupCode = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get("s")?.trim().toLowerCase();
  return value ? value : undefined;
};
