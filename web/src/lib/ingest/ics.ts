// web/src/lib/ingest/ics.ts
import ICAL from "ical.js";
import type { BusyBlock } from "../../types";

const pad = (value: number) => value.toString().padStart(2, "0");

const formatLocalDateTime = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export function parseIcsBusy(icsText: string): BusyBlock[] {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const events = comp.getAllSubcomponents("vevent");
  const out: BusyBlock[] = [];
  for (const ev of events) {
    const v = new (ICAL as any).Event(ev);
    if (!v?.startDate || !v?.endDate) continue;

    const isAllDay = Boolean(v.startDate.isDate);
    const startDate = v.startDate.toJSDate();
    const endDate = v.endDate.toJSDate();
    if (isAllDay) {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
    }

    const start = formatLocalDateTime(startDate);
    const end = formatLocalDateTime(endDate);
    const title = v?.summary ? String(v.summary) : "Busy";
    const key = `${start}|${end}|${title}`;

    out.push({ id: key, title, start, end });
  }
  return out;
}
