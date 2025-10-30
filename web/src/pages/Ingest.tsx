import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "../firebase";
import {
  collection,
  doc,
  writeBatch,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { parseAssessmentsCsv, CSV_TEMPLATE } from "../lib/ingest/csv";
import { parseIcsBusy, BusyBlock } from "../lib/ingest/ics";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/build/pdf";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

import type { Assessment } from "../types";

type Tab = "csv" | "ics";

type EditableAssessment = Assessment & { id?: string };
type UploadRecord = {
  id: string;
  name: string;
  kind: "csv" | "ics";
  uploadedAt: string;
  source: "file" | "manual";
};

let pdfWorkerSingleton: Worker | null = null;
if (typeof window !== "undefined") {
  pdfWorkerSingleton = new PdfWorker();
  GlobalWorkerOptions.workerPort = pdfWorkerSingleton;
}

const emptyAssessment = (): EditableAssessment => ({
  title: "",
  dueDate: new Date().toISOString(),
  weight: undefined,
  course: "",
  notes: "", // still fine to keep for backward compatibility
  specUrl: undefined,
  specPath: undefined,
  specName: undefined,
  specText: undefined,
  rubricUrl: undefined,
  rubricPath: undefined,
  rubricName: undefined,
  rubricText: undefined,
});

export default function Ingest() {
  const [uid, setUid] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("csv");

  // CSV state (assessments)
  const [rows, setRows] = useState<EditableAssessment[]>([]);
  const [csvBusy, setCsvBusy] = useState(false);

  // ICS state (busy times)
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [icsBusy, setIcsBusy] = useState(false);

  const [savedAssessments, setSavedAssessments] = useState<EditableAssessment[]>([]);
  const [savedBusyTimes, setSavedBusyTimes] = useState<BusyBlock[]>([]);
  const [icsConflicts, setIcsConflicts] = useState<string[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadRecord[]>([]);
  const [rowsDirty, setRowsDirty] = useState(false);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(false);

  const [lastCsvName, setLastCsvName] = useState<string | null>(null);
  const [csvSource, setCsvSource] = useState<"file" | "manual" | null>(null);
  const [lastIcsName, setLastIcsName] = useState<string | null>(null);

  const upcomingBusyPreview = (() => {
    const future = savedBusyTimes.filter(
      (block) => new Date(block.end).getTime() >= Date.now()
    );
    if (future.length) {
      return future.slice(0, 10);
    }
    return savedBusyTimes.slice(0, 10);
  })();
  const recentCsvFiles = uploadHistory
    .filter((u) => u.kind === "csv" && u.source === "file")
    .slice(0, 5);
  const recentIcsUploads = uploadHistory
    .filter((u) => u.kind === "ics")
    .slice(0, 5);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid) {
      setSavedAssessments([]);
      setSavedBusyTimes([]);
      setRows([]);
      setBusyBlocks([]);
      setUploadHistory([]);
      return;
    }
    const assessmentsCol = collection(db, "users", uid, "assessments");
    const busyCol = collection(db, "users", uid, "busy");
    const uploadsCol = collection(db, "users", uid, "ingestUploads");

    const unsubAssessments = onSnapshot(assessmentsCol, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Assessment),
      }));
      list.sort(
        (a, b) =>
          new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      );
      setSavedAssessments(list);
    });

    const unsubBusy = onSnapshot(busyCol, (snap) => {
      const list = snap.docs.map((d) => d.data() as BusyBlock);
      list.sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      setSavedBusyTimes(list);
    });

    const unsubUploads = onSnapshot(uploadsCol, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<UploadRecord, "id">) }))
        .sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        );
      setUploadHistory(list);
    });

    return () => {
      unsubAssessments();
      unsubBusy();
      unsubUploads();
    };
  }, [uid]);

  useEffect(() => {
    if (!busyBlocks.length || !savedBusyTimes.length) {
      setIcsConflicts([]);
      return;
    }
    const conflicts = busyBlocks.filter((block) =>
      savedBusyTimes.some((saved) => isOverlap(block, saved))
    );
    setIcsConflicts(conflicts.map((b) => b.id));
  }, [busyBlocks, savedBusyTimes]);

  useEffect(() => {
    if (!rowsDirty) {
      setRows(
        savedAssessments.map((a) => ({
          ...a,
          dueDate: a.dueDate || new Date().toISOString(),
        }))
      );
      setRemovedIds([]);
      setReadOnly(true);
    }
  }, [savedAssessments, rowsDirty]);

  async function recordUpload(
    kind: "csv" | "ics",
    name: string,
    source: "file" | "manual"
  ) {
    if (!uid) return;
    const uploadsCol = collection(db, "users", uid, "ingestUploads");
    const docRef = doc(uploadsCol);
    await setDoc(docRef, {
      name,
      kind,
      source,
      uploadedAt: new Date().toISOString(),
    });
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsvBusy(true);
    try {
      setLastCsvName(f.name);
      setCsvSource("file");
      setReadOnly(false);
      const text = await f.text();
      const parsed = parseAssessmentsCsv(text);
      setRows((prev) => {
        if (!parsed.length) return prev.length ? prev : [emptyAssessment()];
        const next = [...prev];
        parsed.forEach((row) => {
          next.push({ ...row });
        });
        return next;
      });
      setRowsDirty(true);
    } catch (e: any) {
      alert(`CSV parse failed: ${e.message || e}`);
    } finally {
      setCsvBusy(false);
      e.target.value = "";
    }
  }

  function addRow() {
    if (readOnly) return;
    setReadOnly(false);
    setRows((prev) => [...prev, emptyAssessment()]);
    setCsvSource((prev) => prev ?? "manual");
    setLastCsvName((prev) => prev ?? "Manual entry");
    setRowsDirty(true);
  }

  function clearRows() {
    if (readOnly) return;
    setRemovedIds((prev) => [
      ...prev,
      ...rows.map((r) => r.id).filter(Boolean) as string[],
    ]);
    setRows([]);
    setCsvSource("manual");
    setLastCsvName("Manual entry");
    setRowsDirty(true);
  }

  function updateRow(i: number, field: keyof Assessment, val: any) {
    if (readOnly) return;
    setRowsDirty(true);
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: val };
      return copy;
    });
  }

  function unlockEditing() {
    setReadOnly(false);
    setRowsDirty(false);
  }

  async function saveAssessments() {
    if (!uid) return alert("Please sign in first.");
    if (!rows.length) return alert("Add at least one assessment.");

    // minimal validation
    const valid = rows
      .map((row) => ({
        ...row,
        dueDate: row.dueDate || new Date().toISOString(),
      }))
      .filter((r) => r.title && r.dueDate);
    if (!valid.length) return alert("Each row needs a Title and Due date.");

    const col = collection(db, "users", uid, "assessments");
    const batch = writeBatch(db);
    const keepIds = new Set<string>();
    const nextRows: EditableAssessment[] = [];

    try {
      valid.forEach((a) => {
        const { id, ...rest } = a;
        const docRef = id ? doc(col, id) : doc(col);
        const payload: Record<string, any> = {};
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            payload[key] = value;
          }
        });
        batch.set(docRef, payload);
        keepIds.add(docRef.id);
        nextRows.push({ ...a, id: docRef.id });
      });

      Array.from(new Set(removedIds))
        .filter((id) => id && !keepIds.has(id))
        .forEach((id) => batch.delete(doc(col, id)));

      await batch.commit();
      setRows(nextRows);
      setRowsDirty(false);
      setRemovedIds([]);
      setReadOnly(true);

      if (csvSource) {
        const label =
          csvSource === "file"
            ? lastCsvName ?? "Imported CSV"
            : lastCsvName ?? "Manual entry";
        recordUpload("csv", label, csvSource).catch(console.error);
      }
      setCsvSource(null);
      setLastCsvName(null);

      alert(`Saved ${valid.length} assessment(s). Go to Milestones next.`);
    } catch (err: any) {
      console.error("[Ingest] failed to save assessments", err);
      alert(err?.message || "Failed to save assessments.");
    }
  }

  // ---------- ICS handlers ----------
  async function handleIcsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setIcsBusy(true);
    try {
      setLastIcsName(f.name);
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
    const existingIds = new Set(savedBusyTimes.map((b) => b.id));
    const uniqueBlocks = new Map<string, BusyBlock>();
    busyBlocks.forEach((block) => {
      uniqueBlocks.set(block.id, block);
    });
    let newCount = 0;
    uniqueBlocks.forEach((block) => {
      const ref = doc(col, block.id);
      batch.set(ref, block);
      if (!existingIds.has(block.id)) newCount += 1;
    });
    await batch.commit();
    if (lastIcsName) {
      recordUpload("ics", lastIcsName, "file").catch(console.error);
      setLastIcsName(null);
    }
    alert(
      `Saved ${uniqueBlocks.size} busy block(s).` +
        (newCount
          ? ` Added ${newCount} new event${newCount === 1 ? "" : "s"}.`
          : "") +
        (icsConflicts.length
          ? ` ${icsConflicts.length} overlap${
              icsConflicts.length === 1 ? "" : "s"
            } detected with existing busy times.`
          : "")
    );
    setBusyBlocks([]);
    setIcsConflicts([]);
  }

  function titleSlug(t: string) {
    return t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // ---------- UI ----------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7ff",
        padding: "2.5rem 1.2rem",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          boxShadow: "0 18px 40px rgba(56,76,126,0.12)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)",
            color: "white",
            padding: "1.8rem",
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
                    onClick={() => {
                      setReadOnly(false);
                      setRows([emptyAssessment()]);
                      setCsvSource("manual");
                      setLastCsvName("Manual entry");
                      setRowsDirty(true);
                    }}
                    style={goodBtn}
                  >
                    + Start with blank table
                  </button>
                </div>

                {recentCsvFiles.length > 0 && (
                  <div style={uploadHistoryInline}>
                    <span style={uploadHistoryLabel}>Recent CSV saves:</span>
                    <div style={uploadChipRow}>
                      {recentCsvFiles.map((upload) => (
                        <span key={upload.id} style={uploadChip}>
                          <span>{upload.name}</span>
                          <span style={uploadChipMeta}>
                            {new Date(upload.uploadedAt).toLocaleString("en-AU", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p style={{ marginTop: 12, color: "#475569" }}>
                  Upload a CSV with columns:{" "}
                  <code>title, dueDate, weight, course</code>. You can edit
                  everything below before saving. Attach assignment briefs in
                  the <strong>Specs</strong> column and detailed marking
                  criteria in the new <strong>Rubric</strong> column so milestone
                  generation can reference both.
                </p>
              </div>

              <div
                style={{
                  margin: "1rem 0 0.75rem 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    color: "#111827",
                    fontSize: "1.05rem",
                  }}
                >
                  Working assessments ({rows.length})
                </h3>
                <span style={{ color: "#64748b", fontSize: "0.9rem" }}>
                  {readOnly
                    ? "Locked after your last save. Upload a CSV or unlock to make changes."
                    : "Edit any row below, add more, then save to sync with Milestones."}
                </span>
              </div>

              {readOnly && (
                <div style={lockBanner}>
                  <span>
                    ✅ Assessments saved. Upload another CSV to append, or
                    unlock editing to tweak existing rows.
                  </span>
                  <button onClick={unlockEditing} style={unlockBtn}>
                    Unlock editing
                  </button>
                </div>
              )}

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
                      <th className="th">📄 Rubric</th>
                      <th className="th">📎 Specs</th>
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
                            disabled={readOnly}
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
                            disabled={readOnly}
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
                            disabled={readOnly}
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
                            disabled={readOnly}
                          />
                        </td>
                        <td className="td" style={{ minWidth: 220 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <input
                              type="file"
                              accept="application/pdf"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.currentTarget.value = "";
                                if (!file) return;
                                if (!uid) {
                                  alert("Please sign in first.");
                                  return;
                                }

                                try {
                                  const safeTitle = rows[i].title
                                    ? titleSlug(rows[i].title)
                                    : `assessment-${i}`;
                                  const path = `users/${uid}/rubrics/${safeTitle}/${Date.now()}-${file.name}`;
                                  const fileRef = ref(storage, path);
                                  await uploadBytes(fileRef, file);
                                  const url = await getDownloadURL(fileRef);
                                  const text = await extractPdfText(file);

                                  setRows((prev) => {
                                    const copy = [...prev];
                                    copy[i] = {
                                      ...copy[i],
                                      rubricUrl: url,
                                      rubricPath: path,
                                      rubricName: file.name,
                                      rubricText: text || undefined,
                                    } as any;
                                    return copy;
                                  });
                                  setRowsDirty(true);
                                } catch (err: any) {
                                  alert(
                                    err?.message || "Failed to upload rubric PDF."
                                  );
                                }
                              }}
                              disabled={readOnly}
                            />
                            {(r as any).rubricUrl && (
                              <div style={{ display: "flex", gap: 8 }}>
                                <a
                                  href={(r as any).rubricUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ fontSize: "0.9rem" }}
                                >
                                  📑 {(r as any).rubricName || "View rubric"}
                                </a>
                                {!readOnly && (
                                  <button
                                    onClick={() => {
                                      setRows((prev) => {
                                        const copy = [...prev];
                                        copy[i] = {
                                          ...copy[i],
                                          rubricUrl: undefined,
                                          rubricPath: undefined,
                                          rubricName: undefined,
                                          rubricText: undefined,
                                        } as any;
                                        return copy;
                                      });
                                      setRowsDirty(true);
                                    }}
                                    style={{ ...linkBtn, padding: 0 }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="td" style={{ minWidth: 220 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <input
                              type="file"
                              accept="application/pdf"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.currentTarget.value = "";
                                if (!file) return;
                                if (!uid) {
                                  alert("Please sign in first.");
                                  return;
                                }

                                try {
                                  const safeTitle = rows[i].title
                                    ? titleSlug(rows[i].title)
                                    : `assessment-${i}`;
                                  const path = `users/${uid}/specs/${safeTitle}/${Date.now()}-${file.name}`;
                                  const fileRef = ref(storage, path);
                                  await uploadBytes(fileRef, file);
                                  const url = await getDownloadURL(fileRef);
                                  const text = await extractPdfText(file);

                                  // stash on the row; saved to Firestore by saveAssessments()
                                  setRows((prev) => {
                                    const copy = [...prev];
                                    copy[i] = {
                                      ...copy[i],
                                      specUrl: url,
                                      specPath: path,
                                      specName: file.name,
                                      specText: text || undefined,
                                    } as any;
                                    return copy;
                                  });
                                  setRowsDirty(true);
                                } catch (err: any) {
                                  alert(
                                    err?.message || "Failed to upload PDF."
                                  );
                                }
                              }}
                              disabled={readOnly}
                            />
                            {(r as any).specUrl && (
                              <div style={{ display: "flex", gap: 8 }}>
                                <a
                                  href={(r as any).specUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ fontSize: "0.9rem" }}
                                >
                                  📄 {(r as any).specName || "View spec"}
                                </a>
                                {!readOnly && (
                                  <button
                                    onClick={() => {
                                      setRows((prev) => {
                                        const copy = [...prev];
                                        copy[i] = {
                                          ...copy[i],
                                          specUrl: undefined,
                                          specPath: undefined,
                                          specName: undefined,
                                          specText: undefined,
                                        } as any;
                                        return copy;
                                      });
                                      setRowsDirty(true);
                                    }}
                                    style={{ ...linkBtn, padding: 0 }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="td" style={{ textAlign: "right" }}>
                          <button
                            onClick={() => {
                              if (readOnly) return;
                              setRowsDirty(true);
                              setRemovedIds((prevRemoved) => {
                                const id = rows[i]?.id;
                                return id ? [...prevRemoved, id] : prevRemoved;
                              });
                              setRows((prev) => prev.filter((_, j) => j !== i));
                            }}
                            style={{
                              ...smallDanger,
                              cursor: readOnly ? "not-allowed" : smallDanger.cursor,
                              opacity: readOnly ? 0.6 : 1,
                            }}
                            title="Remove row"
                            disabled={readOnly}
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
                  <button
                    onClick={addRow}
                    style={{
                      ...goodBtn,
                      opacity: readOnly ? 0.6 : 1,
                      cursor: readOnly ? "not-allowed" : "pointer",
                    }}
                    disabled={readOnly}
                  >
                    + Row
                  </button>
                  <button
                    onClick={clearRows}
                    style={{
                      ...mutedBtn,
                      opacity: readOnly ? 0.5 : 1,
                      cursor: readOnly ? "not-allowed" : "pointer",
                    }}
                    disabled={readOnly}
                  >
                    Clear
                  </button>
                </div>
                <button
                  onClick={saveAssessments}
                  style={{
                    ...saveBtn,
                    opacity: readOnly || !rowsDirty ? 0.6 : 1,
                    cursor:
                      readOnly || !rowsDirty ? "not-allowed" : saveBtn.cursor,
                  }}
                  disabled={readOnly || !rowsDirty}
                >
                  {readOnly
                    ? "🔒 Saved"
                    : `💾 Save ${rows.length} Assessment${rows.length !== 1 ? "s" : ""}`}
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
                {recentIcsUploads.length > 0 && (
                  <div style={{ ...uploadHistoryInline, marginTop: "0.75rem" }}>
                    <span style={uploadHistoryLabel}>Recent calendars:</span>
                    <div style={uploadChipRow}>
                      {recentIcsUploads.map((upload) => (
                        <span key={upload.id} style={uploadChip}>
                          <span>{upload.name}</span>
                          <span style={uploadChipMeta}>
                            {new Date(upload.uploadedAt).toLocaleString("en-AU", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ margin: "1rem 0" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      color: "#111827",
                      fontSize: "1.05rem",
                    }}
                  >
                    Saved busy times ({savedBusyTimes.length})
                  </h3>
                  {savedBusyTimes.length > 0 && (
                    <span style={{ color: "#64748b", fontSize: "0.9rem" }}>
                      Showing {upcomingBusyPreview.length} upcoming block
                      {upcomingBusyPreview.length === 1 ? "" : "s"}.
                    </span>
                  )}
                </div>
                {savedBusyTimes.length ? (
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th className="th">Title</th>
                          <th className="th">Start</th>
                          <th className="th">End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingBusyPreview.map((block) => (
                          <tr
                            key={`saved-${block.id}`}
                            style={{ borderTop: "1px solid #eef2f7" }}
                          >
                            <td className="td">{block.title}</td>
                            <td className="td">
                              {new Date(block.start).toLocaleString("en-AU")}
                            </td>
                            <td className="td">
                              {new Date(block.end).toLocaleString("en-AU")}
                            </td>
                          </tr>
                        ))}
                        {savedBusyTimes.length > upcomingBusyPreview.length && (
                          <tr>
                            <td
                              className="td"
                              colSpan={3}
                              style={{ color: "#64748b" }}
                            >
                              {savedBusyTimes.length -
                                upcomingBusyPreview.length}{" "}
                              additional saved busy block
                              {savedBusyTimes.length -
                                upcomingBusyPreview.length ===
                              1
                                ? ""
                                : "s"}{" "}
                              not shown.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: 12,
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                    }}
                  >
                    No busy times saved yet. Upload an ICS file to add your first
                    set of busy blocks.
                  </div>
                )}
              </div>

              {busyBlocks.length > 0 && (
                <div
                  style={{
                    background: icsConflicts.length ? "#fef2f2" : "#f1f5f9",
                    border: `1px solid ${
                      icsConflicts.length ? "#fecaca" : "#e2e8f0"
                    }`,
                    borderRadius: 12,
                    padding: "0.75rem 1rem",
                    marginBottom: "0.75rem",
                    color: icsConflicts.length ? "#b91c1c" : "#334155",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {busyBlocks.length} busy block
                    {busyBlocks.length === 1 ? "" : "s"} ready to save.
                  </span>
                  {icsConflicts.length ? (
                    <span>
                      ⚠️ {icsConflicts.length} overlap
                      {icsConflicts.length === 1 ? "" : "s"} with your saved
                      schedule.
                    </span>
                  ) : (
                    <span>✅ No overlaps detected with saved busy times.</span>
                  )}
                </div>
              )}

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
                    {busyBlocks.map((b) => {
                      const hasConflict = icsConflicts.includes(b.id);
                      return (
                        <tr
                          key={b.id}
                          style={{
                            borderTop: "1px solid #eef2f7",
                            background: hasConflict ? "#fef2f2" : undefined,
                          }}
                        >
                          <td className="td">
                            {hasConflict ? "⚠️ " : ""}
                            {b.title}
                          </td>
                          <td className="td">
                            {new Date(b.start).toLocaleString("en-AU")}
                          </td>
                          <td className="td">
                            {new Date(b.end).toLocaleString("en-AU")}
                          </td>
                        </tr>
                      );
                    })}
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

async function extractPdfText(file: File): Promise<string> {
  try {
    const data = await file.arrayBuffer();
    const loadingTask = getDocument({ data });
    const doc = await loadingTask.promise;
    let combined = "";
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      combined += pageText + "\n";
    }
    await doc.cleanup();
    doc.destroy();
    const normalised = combined.replace(/\s+/g, " ").trim();
    return normalised.slice(0, 20000);
  } catch (err) {
    console.error("[Ingest] Failed to extract PDF text", err);
    return "";
  }
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

const uploadHistoryInline: React.CSSProperties = {
  marginTop: "0.6rem",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const uploadHistoryLabel: React.CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "#1e293b",
};
const uploadChipRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};
const uploadChip: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  minWidth: 140,
  padding: "0.45rem 0.65rem",
  borderRadius: 8,
  background: "white",
  border: "1px solid #cbd5e1",
  boxShadow: "0 2px 6px rgba(15,23,42,0.06)",
  fontSize: "0.85rem",
  color: "#1e293b",
};
const uploadChipMeta: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#64748b",
};
const lockBanner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  padding: "0.75rem 1rem",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#f1f5f9",
  color: "#0f172a",
  marginBottom: "0.75rem",
};
const unlockBtn: React.CSSProperties = {
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  color: "white",
  border: "none",
  borderRadius: 999,
  padding: "0.4rem 0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};

function isOverlap(a: BusyBlock, b: BusyBlock) {
  const aStart = new Date(a.start).getTime();
  const aEnd = new Date(a.end).getTime();
  const bStart = new Date(b.start).getTime();
  const bEnd = new Date(b.end).getTime();
  return aStart < bEnd && aEnd > bStart;
}

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
