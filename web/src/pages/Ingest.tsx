import { useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, setDoc } from "firebase/firestore";
import ICAL from "ical.js";
import Papa from "papaparse";

type A = { title:string; dueDate:string; weight?:number; course?:string; notes?:string };

export default function Ingest() {
  const [kind, setKind] = useState<"ics"|"csv">("ics");
  const [rows, setRows] = useState<A[]|null>(null);
  const [busy, setBusy] = useState(false);
  const uid = auth.currentUser?.uid!;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    const text = await f.text();
    const out:A[] = [];

    if (kind === "ics") {
      const jcal = ICAL.parse(text);
      const comp = new ICAL.Component(jcal);
      const events = comp.getAllSubcomponents("vevent");
      for (const ev of events) {
        const v = new (ICAL as any).Event(ev);
        if (v.summary && v.startDate) {
          out.push({
            title: String(v.summary),
            dueDate: v.startDate.toJSDate().toISOString(),
            notes: v.description ? String(v.description) : undefined,
          });
        }
      }
    } else {
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
    setBusy(false);
  }

  async function save() {
    if (!rows) return;
    const col = collection(db, "users", uid, "assessments");
    await Promise.all(rows.map(a => setDoc(doc(col), a)));
    alert("Saved! Go to Milestones next.");
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Upload Schedule (UC1)</h2>
      <label>Format:{" "}
        <select value={kind} onChange={e=>setKind(e.target.value as any)}>
          <option value="ics">ICS</option>
          <option value="csv">CSV</option>
        </select>
      </label>{" "}
      <input type="file" accept={kind==="ics" ? ".ics" : ".csv"} onChange={onFile} />
      {busy && <p>Parsing…</p>}

      {rows && (
        <>
          <h3>Review & Confirm</h3>
          <table>
            <thead><tr><th>Title</th><th>Due</th><th>Weight</th><th>Course</th></tr></thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i}>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>r.title=e.currentTarget.textContent||r.title}>{r.title}</td>
                  <td>{new Date(r.dueDate).toLocaleString()}</td>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>r.weight=Number(e.currentTarget.textContent)||undefined}>{r.weight||""}</td>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>r.course=e.currentTarget.textContent||undefined}>{r.course||""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={save}>Save</button>
        </>
      )}
    </div>
  );
}
