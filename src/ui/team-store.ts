const KEY = "team";

export const loadTeam = (): string | undefined => {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export const saveTeam = (team: string | undefined): void => {
  try {
    if (team === undefined) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, team);
  } catch {
    return;
  }
};
