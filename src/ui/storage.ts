export const readRaw = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

export const writeRaw = (key: string, value: string | undefined): void => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
};

export const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const readJson = <T>(key: string, isValid: (value: unknown) => value is T): T | undefined => {
  const raw = readRaw(key);
  if (raw === undefined) return undefined;
  const parsed = parseJson(raw);
  return isValid(parsed) ? parsed : undefined;
};
