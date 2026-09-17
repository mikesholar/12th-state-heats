export type SheetReply = { readonly ok: boolean; readonly error?: string };

export const isSheetReply = (value: unknown): value is SheetReply =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  typeof value.ok === "boolean" &&
  (!("error" in value) || typeof value.error === "string");

export const scheduleOf = (reply: SheetReply): unknown => ("schedule" in reply ? reply.schedule : undefined);
