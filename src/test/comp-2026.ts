import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";
import raw from "./comp-2026.json";

const decoded = decodeSchedule(raw);
if (!decoded.success) throw new Error(`comp-2026.json: ${decoded.error}`);

export const comp2026: Schedule = decoded.data;
