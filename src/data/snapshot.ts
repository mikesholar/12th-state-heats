import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";
import raw from "./schedule-snapshot.json";

const decoded = decodeSchedule(raw);
if (!decoded.success) throw new Error(`schedule-snapshot.json: ${decoded.error}`);

export const snapshotSchedule: Schedule = decoded.data;
