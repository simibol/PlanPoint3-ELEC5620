import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";

type Assessment = { title: string; dueDate: string; weight?: number; course?: string; notes?: string };
type Milestone = { title: string; targetDate: string; estimateHrs?: number; assessmentTitle: string };

type MilestonesResponse = {
  milestones: Milestone[];
  source?: "llm" | "rule-based";
  error?: string;
};

export default function Milestones() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [draft, setDraft] = useState<Milestone[] | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    (async () => {
      if (!uid) return;
      const snap = await getDocs(collection(db, "users", uid, "assessments"));
      setAssessments(snap.docs.map((d) => d.data() as Assessment));
    })();
  }, [uid]);

    async function generate(a: Assessment) {
    setSelected(a);
    setBusy(true);
    try {
        const res = await fetch("/api/generate-milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: a, rubricText: "" }),
        });
        if (!res.ok) {
        throw new Error(`API ${res.status}: ${await res.text()}`);
        }

        const data = (await res.json()) as MilestonesResponse;   // <-- assert
        if (!data.milestones) throw new Error(data.error || "Bad response");

        setDraft(data.milestones);
    } catch (e: any) {
        alert(e.message || "Failed to generate");
    } finally {
        setBusy(false);
    }
    }

  async function saveAll() {
    if (!uid || !draft?.length) return;
    const col = collection(db, "users", uid, "milestones");
    await Promise.all(draft.map((m) => setDoc(doc(col), m)));
    alert("Milestones saved!");
    setDraft(null);
    setSelected(null);
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h2>Milestone Generator (UC2)</h2>

      {!assessments.length && <p>Add assessments on the Ingest page first.</p>}

      <ol>
        {assessments.map((a) => (
          <li key={`${a.title}-${a.dueDate}`} style={{ marginBottom: 8 }}>
            {a.title} — due {new Date(a.dueDate).toLocaleDateString()}{" "}
            <button onClick={() => generate(a)} disabled={busy}>
              {busy && selected?.title === a.title ? "Generating…" : "Generate"}
            </button>
          </li>
        ))}
      </ol>

      {draft && selected && (
        <>
          <h3>Review — {selected.title}</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Title</th>
                  <th style={{ textAlign: "left" }}>Target Date</th>
                  <th style={{ textAlign: "left" }}>Est. (hrs)</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((m, i) => (
                  <tr key={i}>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => (m.title = e.currentTarget.textContent || m.title)}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {m.title}
                    </td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const v = e.currentTarget.textContent || m.targetDate;
                        m.targetDate = new Date(v).toISOString();
                      }}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {new Date(m.targetDate).toLocaleString()}
                    </td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const v = e.currentTarget.textContent?.trim();
                        m.estimateHrs = v ? Number(v) : m.estimateHrs;
                      }}
                      style={{ borderBottom: "1px solid #ddd" }}
                    >
                      {m.estimateHrs ?? 2}
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
