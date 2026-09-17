export type SheetCallOptions = {
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
  readonly body?: string;
};

export type SheetCall = { readonly body: unknown };

export const callSheet = async ({ endpoint, fetchFn, timeoutMs, body }: SheetCallOptions): Promise<SheetCall | undefined> => {
  if (endpoint === "") return undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  const init: RequestInit = body === undefined ? { cache: "no-store", signal } : { method: "POST", body, signal };
  try {
    const response = await fetchFn(endpoint, init);
    if (!response.ok) return undefined;
    return { body: await response.json() };
  } catch {
    return undefined;
  }
};
