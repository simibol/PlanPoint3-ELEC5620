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
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '2rem 1rem'
    }}>
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto',
        background: 'white',
        borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Header Section */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          padding: '2rem',
          color: 'white'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              📚
            </div>
            <h1 style={{ 
              margin: 0, 
              fontSize: '2rem', 
              fontWeight: '700',
              letterSpacing: '-0.025em'
            }}>
              Upload Schedule
            </h1>
          </div>
          <p style={{ 
            margin: 0, 
            opacity: 0.9,
            fontSize: '1.1rem',
            fontWeight: '400'
          }}>
            Import your academic assessments from ICS calendar files or CSV spreadsheets
          </p>
        </div>

        {/* Upload Section */}
        <div style={{ padding: '2rem' }}>
          <div style={{
            background: '#f8fafc',
            border: '2px dashed #cbd5e1',
            borderRadius: '12px',
            padding: '2rem',
            textAlign: 'center',
            marginBottom: '2rem'
          }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'white',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                marginBottom: '1rem'
              }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: '#374151'
                }}>
                  📋 Format:
                  <select 
                    value={format} 
                    onChange={(e) => setFormat(e.target.value as any)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '0.95rem',
                      background: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="ics">📅 ICS Calendar</option>
                    <option value="csv">📊 CSV Spreadsheet</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{
              display: 'inline-block',
              position: 'relative',
              cursor: 'pointer'
            }}>
              <input
                type="file"
                accept={format === "ics" ? ".ics" : ".csv"}
                onChange={handleFile}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer'
                }}
              />
              <div style={{
                background: busy ? '#f3f4f6' : '#4f46e5',
                color: busy ? '#6b7280' : 'white',
                padding: '1rem 2rem',
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '1rem',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s ease'
              }}>
                {busy ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid #d1d5db',
                      borderTop: '2px solid #6b7280',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Parsing file...
                  </>
                ) : (
                  <>
                    📤 Choose {format.toUpperCase()} File
                  </>
                )}
              </div>
            </div>

            <p style={{ 
              marginTop: '1rem', 
              color: '#64748b',
              fontSize: '0.9rem'
            }}>
              {format === "ics" 
                ? "Upload a calendar file (.ics) exported from your academic calendar"
                : "Upload a CSV file with columns: title, dueDate, weight, course, notes"
              }
            </p>
          </div>

          {rows && (
            <div style={{ marginTop: '2rem' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1.5rem',
                padding: '1rem',
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '8px'
              }}>
                <div style={{ color: '#065f46', fontSize: '1.25rem' }}>✅</div>
                <div>
                  <h3 style={{ 
                    margin: 0, 
                    color: '#065f46',
                    fontSize: '1.1rem',
                    fontWeight: '600'
                  }}>
                    Review & Edit Your Assessments
                  </h3>
                  <p style={{ 
                    margin: '0.25rem 0 0 0', 
                    color: '#047857',
                    fontSize: '0.9rem'
                  }}>
                    Found {rows.length} assessment{rows.length !== 1 ? 's' : ''}. Click on any field to edit.
                  </p>
                </div>
              </div>

              <div style={{ 
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 6px rgba(0,0,0,0.05)'
              }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ 
                    borderCollapse: "collapse", 
                    width: "100%",
                    fontSize: '0.95rem'
                  }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ 
                          textAlign: "left",
                          padding: '1rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb'
                        }}>
                          📝 Assessment Title
                        </th>
                        <th style={{ 
                          textAlign: "left",
                          padding: '1rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb'
                        }}>
                          📅 Due Date
                        </th>
                        <th style={{ 
                          textAlign: "left",
                          padding: '1rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb'
                        }}>
                          ⚖️ Weight (%)
                        </th>
                        <th style={{ 
                          textAlign: "left",
                          padding: '1rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb'
                        }}>
                          🎓 Course
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{
                          borderBottom: i < rows.length - 1 ? '1px solid #f3f4f6' : 'none'
                        }}>
                          <td
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => (r.title = e.currentTarget.textContent || r.title)}
                            style={{ 
                              padding: '1rem',
                              borderRight: '1px solid #f3f4f6',
                              cursor: 'text',
                              minWidth: '200px',
                              fontWeight: '500',
                              color: '#111827'
                            }}
                          >
                            {r.title}
                          </td>
                          <td style={{ 
                            padding: '1rem',
                            borderRight: '1px solid #f3f4f6',
                            color: '#374151',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem'
                          }}>
                            {new Date(r.dueDate).toLocaleDateString('en-AU', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const v = e.currentTarget.textContent?.trim();
                              r.weight = v ? Number(v) : undefined;
                            }}
                            style={{ 
                              padding: '1rem',
                              borderRight: '1px solid #f3f4f6',
                              cursor: 'text',
                              textAlign: 'center',
                              color: '#374151',
                              fontWeight: '500'
                            }}
                          >
                            {r.weight ?? ""}
                          </td>
                          <td
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => (r.course = e.currentTarget.textContent || undefined)}
                            style={{ 
                              padding: '1rem',
                              cursor: 'text',
                              color: '#374151',
                              fontWeight: '500'
                            }}
                          >
                            {r.course ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ 
                marginTop: '2rem',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '1rem'
              }}>
                <button 
                  onClick={() => setRows(null)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    border: '1px solid #d1d5db',
                    background: 'white',
                    color: '#374151',
                    borderRadius: '8px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Cancel
                </button>
                <button 
                  onClick={saveAll}
                  style={{
                    padding: '0.75rem 2rem',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '600',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  💾 Save {rows.length} Assessment{rows.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        [contentEditable]:hover {
          background-color: #f8fafc !important;
          outline: 2px solid #e2e8f0;
          border-radius: 4px;
        }
        
        [contentEditable]:focus {
          background-color: #ffffff !important;
          outline: 2px solid #4f46e5;
          border-radius: 4px;
        }
        
        button:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.15) !important;
        }
        
        table tr:hover {
          background-color: #f9fafb !important;
        }
      `}</style>
    </div>
  );
}
