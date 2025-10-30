// web/src/lib/ingest/ics.ts
import ICAL from "ical.js";
import type { BusyBlock } from "../../types";

export function parseIcsBusy(icsText: string): BusyBlock[] {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const events = comp.getAllSubcomponents("vevent");
  const out: BusyBlock[] = [];
  for (const ev of events) {
    const v = new (ICAL as any).Event(ev);
    if (v?.startDate && v?.endDate) {
      const start = v.startDate.toJSDate().toISOString();
      const end = v.endDate.toJSDate().toISOString();
      const title = v?.summary ? String(v.summary) : "Busy";
      out.push({ id: `${start}|${end}`, title, start, end });
    }
  }
  return out;
}
