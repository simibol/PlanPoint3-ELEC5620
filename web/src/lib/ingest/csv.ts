// web/src/lib/ingest/csv.ts
import Papa from "papaparse";
import type { Assessment } from "../../types";

type RawRow = Record<string, string>;

function pick(obj: RawRow, keys: string[]): string | undefined {
  for (const k of keys) {
    const hit = Object.keys(obj).find(
      (h) => h.trim().toLowerCase() === k.toLowerCase()
    );
    if (hit && obj[hit]?.trim()) return obj[hit].trim();
  }
  return undefined;
}

function parseLocalishDate(s?: string): string | undefined {
  if (!s) return undefined;
  // Accept ISO, AU dd/mm/yyyy, mm/dd/yyyy, or "2025-11-10 14:00"
  // Normalise to ISO.
  const tryList = [
    s,
    s.replace(/\//g, "-"),
    s.includes("T") ? s : s.replace(" ", "T"), // add T if space separated
  ];
  for (const candidate of tryList) {
    const d = new Date(candidate);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // AU dd/mm/yyyy HH:mm
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(.*)$/);
  if (m) {
    const [_, dd, mm, yyyy, rest] = m;
    const year = Number(yyyy.length === 2 ? "20" + yyyy : yyyy);
    const iso = new Date(
      `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}${
        rest ? "T" + rest.trim() : ""
      }`
    );
    if (!isNaN(iso.getTime())) return iso.toISOString();
  }
  return undefined;
}

/** Accept flexible headers (title, due/dueDate/date, weight/weight%, course/unit, notes/description) */
export function parseAssessmentsCsv(text: string): Assessment[] {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const out: Assessment[] = [];

  for (const row of parsed.data as RawRow[]) {
    if (!row) continue;
    const title = pick(row, ["title", "assessment", "name"]);
    const due = pick(row, ["dueDate", "due", "deadline", "date", "datetime"]);
    const course = pick(row, ["course", "unit", "subject", "code"]);
    const notes = pick(row, ["notes", "description", "details"]);
    const weightStr = pick(row, ["weight", "weight%", "mark%", "marks"]);

    if (!title) continue;
    const dueIso = parseLocalishDate(due);
    // We require a due date for planning; keep row visible but you can let UI enforce it on save.
    const weight = weightStr ? Number(weightStr.replace("%", "")) : undefined;

    out.push({
      title,
      dueDate: dueIso ?? new Date().toISOString(), // fallback to now; user can edit in table
      weight,
      course: course || undefined,
      notes: notes || undefined,
    });
  }
  return out;
}

/** Downloadable CSV template text */
export const CSV_TEMPLATE = `title,weight,dueDate,course,notes
"ELEC5620 Final Report",40,"2025-11-20 17:00","ELEC5620","See rubric"
"COMP3500 Lab Report 3",10,"2025-10-31 23:59","COMP3500","Submit PDF"
`;
