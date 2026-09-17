export type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const fail = <T>(error: string): Result<T> => ({ success: false, error });
