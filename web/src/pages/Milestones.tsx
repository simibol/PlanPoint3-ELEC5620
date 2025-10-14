import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";

type A = { title:string; dueDate:string; weight?:number; course?:string; notes?:string };
type M = { title:string; targetDate:string; estimateHrs?:number; assessmentTitle:string };

export default function Milestones() {
  const [assessments, setAssessments] = useState<A[]>([]);
  const [sel, setSel] = useState<A|null>(null);
  const [draft, setDraft] = useState<M[]|null>(null);
  const uid = auth.currentUser?.uid!;

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "users", uid, "assessments"));
      setAssessments(snap.docs.map(d => d.data() as A));
    })();
  }, [uid]);

  async function gen(a: A) {
    setSel(a);
    const r = await fetch("/api/generate-milestones", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ assessment: a, rubricText: "" }),
    });
    const out = await r.json();
    setDraft(out.milestones);
  }

  async function save() {
    if (!draft) return;
    const col = collection(db, "users", uid, "milestones");
    await Promise.all(draft.map(m => setDoc(doc(col), m)));
    alert("Milestones saved!");
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Milestone Generator (UC2)</h2>
      <ol>
        {assessments.map(a => (
          <li key={`${a.title}-${a.dueDate}`}>
            {a.title} (due {new Date(a.dueDate).toLocaleDateString()}){" "}
            <button onClick={() => gen(a)}>Generate</button>
          </li>
        ))}
      </ol>

      {draft && sel && (
        <>
          <h3>Review – {sel.title}</h3>
          <table>
            <thead><tr><th>Title</th><th>Target Date</th><th>Est. (hrs)</th></tr></thead>
            <tbody>
              {draft.map((m,i)=>(
                <tr key={i}>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>m.title=e.currentTarget.textContent||m.title}>{m.title}</td>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>m.targetDate=new Date(e.currentTarget.textContent||m.targetDate).toISOString()}>{new Date(m.targetDate).toLocaleDateString()}</td>
                  <td contentEditable suppressContentEditableWarning onBlur={e=>m.estimateHrs=Number(e.currentTarget.textContent)||m.estimateHrs}>{m.estimateHrs||2}</td>
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
