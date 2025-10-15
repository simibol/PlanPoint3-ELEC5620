import { useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import ICAL from "ical.js";
import Papa from "papaparse";

type Assessment = {
  title: string;
  dueDate: string;          // ISO string
  weight?: number;
  course?: string;
  notes?: string;
};

export default function Ingest() {
  const [format, setFormat] = useState<"ics" | "csv">("ics");
  const [rows, setRows] = useState<Assessment[] | null>(null);
  const [busy, setBusy] = useState(false);

  const uid = auth.currentUser?.uid;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const text = await f.text();
    const out: Assessment[] = [];

    try {
      if (format === "ics") {
        // Parse .ics using ical.js
        const jcal = ICAL.parse(text);
        const comp = new ICAL.Component(jcal);
        const events = comp.getAllSubcomponents("vevent");
        for (const ev of events) {
          const v = new (ICAL as any).Event(ev);
          if (v?.summary && v?.startDate) {
            out.push({
              title: String(v.summary),
              dueDate: v.startDate.toJSDate().toISOString(),
              notes: v.description ? String(v.description) : undefined,
            });
          }
        }
      } else {
        // Parse CSV with PapaParse (expects headers: title,dueDate,weight,course,notes)
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        for (const r of parsed.data as any[]) {
          if (!r.title || !r.dueDate) continue;
          out.push({
            title: r.title,
            dueDate: new Date(r.dueDate).toISOString(),
            weight: r.weight ? Number(r.weight) : undefined,
            course: r.course || undefined,
            notes: r.notes || undefined,
          });
        }
      }
      setRows(out);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!uid || !rows?.length) return alert("Sign in and add some rows first.");
    const col = collection(db, "users", uid, "assessments");
    await Promise.all(rows.map((a) => setDoc(doc(col), a)));
    alert("Saved to Firestore. Go to Milestones next.");
    setRows(null);
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h2>Upload Schedule (UC1)</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label>
          Format:{" "}
          <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
            <option value="ics">ICS</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <input
          type="file"
          accept={format === "ics" ? ".ics" : ".csv"}
          onChange={handleFile}
        />
        {busy && <span>Parsing…</span>}
      </div>

      {rows && (
        <>
          <h3>Review & Confirm</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Title</th>
                  <th style={{ textAlign: "left" }}>Due</th>
                  <th style={{ textAlign: "left" }}>Weight</th>
                  <th style={{ textAlign: "left" }}>Course</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => (r.title = e.currentTarget.textContent || r.title)}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {r.title}
                    </td>
                    <td style={{ borderBottom: "1px solid #ddd" }}>
                      {new Date(r.dueDate).toLocaleString()}
                    </td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const v = e.currentTarget.textContent?.trim();
                        r.weight = v ? Number(v) : undefined;
                      }}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {r.weight ?? ""}
                    </td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => (r.course = e.currentTarget.textContent || undefined)}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {r.course ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={saveAll}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}
