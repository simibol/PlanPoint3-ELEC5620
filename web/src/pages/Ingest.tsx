// web/src/pages/Ingest.tsx
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { collection, doc, setDoc, writeBatch, getDocs, onSnapshot } from "firebase/firestore";
//import { storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

import { parseAssessmentsCsv, CSV_TEMPLATE } from "../lib/ingest/csv";
import { parseIcsBusy, BusyBlock } from "../lib/ingest/ics";

import type { Assessment } from "../types";

type Tab = "csv" | "ics";

const emptyAssessment = (): Assessment => ({
  title: "",
  dueDate: new Date().toISOString(),
  weight: undefined,
  course: "",
  notes: "",
});

export default function Ingest() {
  const [uid, setUid] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("csv");

  // CSV state (assessments)
  const [rows, setRows] = useState<Assessment[]>([]);
  const [csvBusy, setCsvBusy] = useState(false);

  // ICS state (busy times)
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [icsBusy, setIcsBusy] = useState(false);

  const [templates, setTemplates] = useState<
    { id: string; name: string; uploadedAt: string; rowCount: number; filePath: string; downloadURL?: string; header?: string[] }[] 
  >([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    if (!uid) { setTemplates([]); return; }
    const colRef = collection(db, "users", uid, "csvTemplates");
    const unsub = onSnapshot(colRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      // sort latest first
      list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
      setTemplates(list);
    });
    return () => unsub();
  }, [uid]);


  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return unsub;
  }, []);

  // ---------- CSV handlers ----------
  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsvBusy(true);
    try {
      const text = await f.text();
      const parsed = parseAssessmentsCsv(text);
      setRows(parsed.length ? parsed : [emptyAssessment()]);
    } catch (e: any) {
      alert(`CSV parse failed: ${e.message || e}`);
    } finally {
      setCsvBusy(false);
      e.target.value = "";
    }
  }

  function addRow() {
    setRows((prev) => [...prev, emptyAssessment()]);
  }

  function clearRows() {
    setRows([]);
  }

  function updateRow(i: number, field: keyof Assessment, val: any) {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: val };
      return copy;
    });
  }

  async function saveAssessments() {
    if (!uid) return alert("Please sign in first.");
    if (!rows.length) return alert("Add at least one assessment.");
    const col = collection(db, "users", uid, "assessments");
    const batch = writeBatch(db);
    rows.forEach((a) => {
      if (!a.title || !a.dueDate) return; // simple guard
      batch.set(doc(col), a);
    });
    await batch.commit();
    alert(`Saved ${rows.length} assessment(s). Go to Milestones next.`);
  }

  // ---------- ICS handlers ----------
  async function handleIcsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setIcsBusy(true);
    try {
      const text = await f.text();
      const blocks = parseIcsBusy(text);
      setBusyBlocks(blocks);
    } catch (e: any) {
      alert(`ICS parse failed: ${e.message || e}`);
    } finally {
      setIcsBusy(false);
      e.target.value = "";
    }
  }

  async function saveBusyTimes() {
    if (!uid) return alert("Please sign in first.");
    if (!busyBlocks.length) return alert("No busy times to save.");
    const col = collection(db, "users", uid, "busy");
    const batch = writeBatch(db);
    busyBlocks.forEach((b) => {
      batch.set(doc(col), b);
    });
    await batch.commit();
    alert(`Saved ${busyBlocks.length} busy block(s).`);
  }

  // ---------- UI ----------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%)",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          boxShadow: "0 18px 40px rgba(0,0,0,0.12)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg,#7c3aed 0%,#a855f7 100%)",
            color: "white",
            padding: "1.75rem",
          }}
        >
          <h1 style={{ margin: 0 }}>Ingest (Assessments & Busy Times)</h1>
          <p style={{ margin: "0.25rem 0 0 0", opacity: 0.9 }}>
            <strong>CSV</strong> → <strong>Assessments</strong> (editable).{" "}
            <strong>ICS</strong> → <strong>Busy blocks</strong> only (used to
            avoid scheduling).
          </p>
        </div>

        {/* Tabs */}
        <div style={{ padding: "1rem 1.25rem 0 1.25rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setTab("csv")}
              style={tabBtnStyle(tab === "csv")}
              aria-pressed={tab === "csv"}
            >
              📊 CSV (Assessments)
            </button>
            <button
              onClick={() => setTab("ics")}
              style={tabBtnStyle(tab === "ics")}
              aria-pressed={tab === "ics"}
            >
              📅 ICS (Busy times)
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "1.25rem" }}>
          {tab === "csv" ? (
            <>
              {/* Upload + template + blank table */}
              <div style={uploadBox}>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <label style={{ position: "relative" }}>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvFile}
                      disabled={csvBusy}
                      style={hiddenFileInput}
                    />
                    <span style={primaryBtn(csvBusy)}>
                      {csvBusy ? "Parsing..." : "📥 Choose CSV File"}
                    </span>
                  </label>

                  <button
                    onClick={() => {
                      const blob = new Blob([CSV_TEMPLATE], {
                        type: "text/csv;charset=utf-8",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "assessments_template.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={linkBtn}
                  >
                    ↓ Download CSV template
                  </button>

                  <button
                    onClick={() => setRows([emptyAssessment()])}
                    style={goodBtn}
                  >
                    + Start with blank table
                  </button>
                </div>

                <p style={{ marginTop: 12, color: "#475569" }}>
                  Upload a CSV with:{" "}
                  <code>title, weight, dueDate, course, notes</code>. You can
                  edit everything below before saving.
                </p>
              </div>

              {/* Editable table */}
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th className="th">📝 Title</th>
                      <th className="th">📅 Due (local)</th>
                      <th className="th">⚖️ Weight %</th>
                      <th className="th">🎓 Course</th>
                      <th className="th">🗒️ Notes</th>
                      <th className="th" style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #eef2f7" }}>
                        <td className="td">
                          <input
                            value={r.title}
                            onChange={(e) =>
                              updateRow(i, "title", e.target.value)
                            }
                            className="in"
                            placeholder="e.g., ELEC5620 Final Report"
                          />
                        </td>
                        <td className="td">
                          <input
                            type="datetime-local"
                            value={toLocalInputValue(r.dueDate)}
                            onChange={(e) =>
                              updateRow(
                                i,
                                "dueDate",
                                fromLocalInputValue(e.target.value)
                              )
                            }
                            className="in"
                          />
                        </td>
                        <td className="td" style={{ width: 120 }}>
                          <input
                            type="number"
                            value={r.weight ?? ""}
                            onChange={(e) =>
                              updateRow(
                                i,
                                "weight",
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value)
                              )
                            }
                            className="in"
                            min={0}
                            max={100}
                            step={1}
                            placeholder="e.g., 40"
                          />
                        </td>
                        <td className="td" style={{ width: 200 }}>
                          <input
                            value={r.course ?? ""}
                            onChange={(e) =>
                              updateRow(i, "course", e.target.value)
                            }
                            className="in"
                            placeholder="ELEC5620"
                          />
                        </td>
                        <td className="td">
                          <input
                            value={r.notes ?? ""}
                            onChange={(e) =>
                              updateRow(i, "notes", e.target.value)
                            }
                            className="in"
                            placeholder="Add brief notes/rubric hints"
                          />
                        </td>
                        <td className="td" style={{ textAlign: "right" }}>
                          <button
                            onClick={() =>
                              setRows((prev) => prev.filter((_, j) => j !== i))
                            }
                            style={smallDanger}
                            title="Remove row"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td
                          className="td"
                          colSpan={6}
                          style={{ color: "#64748b" }}
                        >
                          No assessments yet. Click{" "}
                          <strong>Start with blank table</strong> or upload a
                          CSV.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Actions */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={addRow} style={goodBtn}>
                    + Row
                  </button>
                  <button onClick={clearRows} style={mutedBtn}>
                    Clear
                  </button>
                </div>
                <button onClick={saveAssessments} style={saveBtn}>
                  💾 Save {rows.length} Assessment{rows.length !== 1 ? "s" : ""}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* ICS upload */}
              <div style={uploadBox}>
                <label style={{ position: "relative" }}>
                  <input
                    type="file"
                    accept=".ics"
                    onChange={handleIcsFile}
                    disabled={icsBusy}
                    style={hiddenFileInput}
                  />
                  <span style={primaryBtn(icsBusy)}>
                    {icsBusy ? "Parsing..." : "📥 Choose ICS File"}
                  </span>
                </label>
                <p style={{ marginTop: 12, color: "#475569" }}>
                  Upload an <code>.ics</code> file (we only store busy times; no
                  assignments are created from ICS).
                </p>
              </div>

              {/* Busy table */}
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th className="th">Title</th>
                      <th className="th">Start</th>
                      <th className="th">End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {busyBlocks.map((b) => (
                      <tr key={b.id} style={{ borderTop: "1px solid #eef2f7" }}>
                        <td className="td">{b.title}</td>
                        <td className="td">
                          {new Date(b.start).toLocaleString("en-AU")}
                        </td>
                        <td className="td">
                          {new Date(b.end).toLocaleString("en-AU")}
                        </td>
                      </tr>
                    ))}
                    {!busyBlocks.length && (
                      <tr>
                        <td
                          className="td"
                          colSpan={3}
                          style={{ color: "#64748b" }}
                        >
                          No busy events parsed yet. Upload an ICS above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button onClick={saveBusyTimes} style={saveBtn}>
                  💾 Save Busy Times
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* quick styles for table cells/inputs */}
      <style>{`
        .th { text-align: left; padding: 0.8rem; font-weight: 600; color: #334155; border-bottom: 2px solid #e5e7eb; }
        .td { padding: 0.75rem; color: #0f172a; }
        .in { width: 100%; padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; }
        .in:focus { outline: 2px solid #6366f1; border-color: #6366f1; }
      `}</style>
    </div>
  );
}

/* ----- small UI helpers ----- */
function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function fromLocalInputValue(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const uploadBox: React.CSSProperties = {
  background: "#f8fafc",
  border: "2px dashed #cbd5e1",
  borderRadius: 12,
  padding: "1rem",
  marginBottom: "1rem",
};

const hiddenFileInput: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  cursor: "pointer",
};

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 0.9rem",
    borderRadius: 999,
    border: active ? "none" : "1px solid #e5e7eb",
    background: active ? "linear-gradient(135deg,#4f46e5,#7c3aed)" : "white",
    color: active ? "white" : "#334155",
    fontWeight: 700,
    cursor: "pointer",
  };
}
const primary = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";
const primaryBtn = (disabled?: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: disabled ? "#e5e7eb" : primary,
  color: disabled ? "#6b7280" : "white",
  padding: "0.75rem 1.25rem",
  borderRadius: 8,
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
});
const linkBtn: React.CSSProperties = {
  color: "#1d4ed8",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
};
const goodBtn: React.CSSProperties = {
  background: "#10b981",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "0.6rem 0.9rem",
  fontWeight: 700,
  cursor: "pointer",
};
const mutedBtn: React.CSSProperties = {
  background: "#f1f5f9",
  color: "#334155",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "0.6rem 0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};
const saveBtn: React.CSSProperties = {
  background: "linear-gradient(135deg,#10b981,#059669)",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "0.75rem 1.25rem",
  fontWeight: 800,
  cursor: "pointer",
};
const smallDanger: React.CSSProperties = {
  background: "#fee2e2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  padding: "0.25rem 0.5rem",
  borderRadius: 6,
  cursor: "pointer",
};
