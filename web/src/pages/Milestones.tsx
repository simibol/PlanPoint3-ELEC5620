import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import type { Assessment, Milestone } from "../types";

type MilestonesResponse = {
  milestones: Milestone[];
  source?: "llm" | "rule-based";
  error?: string;
};

const makeAssessmentKey = (title: string, dueDate?: string) =>
  `${title.trim().toLowerCase()}|${dueDate ? new Date(dueDate).toISOString() : ""}`;

export default function Milestones() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [draft, setDraft] = useState<Milestone[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatedFor, setGeneratedFor] = useState<Set<string>>(new Set());
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) {
      setAssessments([]);
      setGeneratedFor(new Set<string>());
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [assessmentsSnap, milestonesSnap] = await Promise.all([
          getDocs(collection(db, "users", uid, "assessments")),
          getDocs(collection(db, "users", uid, "milestones")),
        ]);
        if (cancelled) return;

        setAssessments(assessmentsSnap.docs.map((d) => d.data() as Assessment));

        const next = new Set<string>();
        milestonesSnap.forEach((docSnap) => {
          const data = docSnap.data() as Milestone;
          if (data.assessmentTitle) {
            next.add(makeAssessmentKey(data.assessmentTitle, data.assessmentDueDate));
          }
        });
        setGeneratedFor(next);
      } catch (error) {
        console.error("[Milestones] failed to load data", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function generate(a: Assessment) {
    const assessmentKey = makeAssessmentKey(a.title, a.dueDate);
    if (generatedFor.has(assessmentKey)) {
      alert("Milestones have already been generated for this assessment.");
      return;
    }
    if (draft && selected && makeAssessmentKey(selected.title, selected.dueDate) === assessmentKey) {
      alert("Milestones already generated for this assessment. Save or cancel them before regenerating.");
      return;
    }

    setSelected(a);
    setBusy(true);
    try {
      const rubricBundle = [a.rubricText, a.specText]
        .filter((segment): segment is string => Boolean(segment && segment.trim()))
        .join("\n\n");

      const res = await fetch("/api/generate-milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment: a,
          rubricText: rubricBundle,
        }),
      });
      if (!res.ok) {
        throw new Error(`API ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as MilestonesResponse;   // <-- assert
      if (!data.milestones) throw new Error(data.error || "Bad response");

      const sanitized = data.milestones.map((m) => ({
        ...m,
        assessmentTitle: m.assessmentTitle ?? a.title,
        assessmentDueDate: m.assessmentDueDate ?? a.dueDate,
      }));
      setDraft(sanitized);
    } catch (e: any) {
      alert(e.message || "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!uid || !draft?.length) return;
    const col = collection(db, "users", uid, "milestones");
    const selectedAssessment = selected;
    await Promise.all(
      draft.map((m) =>
        setDoc(
          doc(col),
          {
            ...m,
            assessmentTitle: selectedAssessment?.title ?? m.assessmentTitle,
            assessmentDueDate: selectedAssessment?.dueDate ?? m.assessmentDueDate,
          }
        )
      )
    );
    if (selectedAssessment) {
      const key = makeAssessmentKey(selectedAssessment.title, selectedAssessment.dueDate);
      setGeneratedFor((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    alert("Milestones saved!");
    setDraft(null);
    setSelected(null);
  }

  // Helper function to get days until due date
  const getDaysUntilDue = (dueDate: string) => {
    const days = Math.ceil((new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return days;
  };

  // Helper function to get priority color based on days remaining
  const getPriorityColor = (dueDate: string) => {
    const days = getDaysUntilDue(dueDate);
    if (days <= 7) return { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' };
    if (days <= 14) return { bg: '#fffbeb', border: '#fed7aa', text: '#d97706' };
    return { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' };
  };

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
          background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
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
              🎯
            </div>
            <h1 style={{ 
              margin: 0, 
              fontSize: '2rem', 
              fontWeight: '700',
              letterSpacing: '-0.025em'
            }}>
              Milestone Generator
            </h1>
          </div>
          <p style={{ 
            margin: 0, 
            opacity: 0.9,
            fontSize: '1.1rem',
            fontWeight: '400'
          }}>
            Break down your assessments into manageable milestones with AI-powered planning
          </p>
        </div>

        <div style={{ padding: '2rem' }}>
          {!assessments.length ? (
            <div style={{
              textAlign: 'center',
              padding: '3rem 2rem',
              background: '#f8fafc',
              borderRadius: '12px',
              border: '2px dashed #cbd5e1'
            }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📚</div>
              <h3 style={{ 
                margin: '0 0 0.5rem 0',
                color: '#374151',
                fontSize: '1.25rem',
                fontWeight: '600'
              }}>
                No Assessments Found
              </h3>
              <p style={{ 
                margin: 0,
                color: '#6b7280',
                fontSize: '1rem'
              }}>
                Upload your assessments on the Ingest page first to generate milestones.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{ 
                margin: '0 0 1.5rem 0',
                color: '#1f2937',
                fontSize: '1.5rem',
                fontWeight: '600'
              }}>
                Your Assessments ({assessments.length})
              </h2>

              <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
                {assessments.map((a) => {
                  const days = getDaysUntilDue(a.dueDate);
                  const priority = getPriorityColor(a.dueDate);
                  const isGenerating = busy && selected?.title === a.title;
                  const alreadyGenerated = generatedFor.has(makeAssessmentKey(a.title, a.dueDate));
                  const buttonDisabled = busy || alreadyGenerated;
                  
                  return (
                    <div 
                      key={`${a.title}-${a.dueDate}`}
                      style={{
                        background: 'white',
                        border: `2px solid ${priority.border}`,
                        borderRadius: '12px',
                        padding: '1.5rem',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                            <h3 style={{ 
                              margin: 0,
                              color: '#1f2937',
                              fontSize: '1.1rem',
                              fontWeight: '600',
                              lineHeight: '1.4'
                            }}>
                              {a.title}
                            </h3>
                            <div style={{
                              background: priority.bg,
                              color: priority.text,
                              padding: '0.25rem 0.75rem',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              border: `1px solid ${priority.border}`
                            }}>
                              {days > 0 ? `${days} days left` : days === 0 ? 'Due today!' : `${Math.abs(days)} days overdue`}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ color: '#6b7280' }}>📅</span>
                              <span style={{ 
                                color: '#374151',
                                fontSize: '0.9rem',
                                fontWeight: '500'
                              }}>
                                {new Date(a.dueDate).toLocaleDateString('en-AU', {
                                  weekday: 'short',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            
                            {a.weight && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#6b7280' }}>⚖️</span>
                                <span style={{ 
                                  color: '#374151',
                                  fontSize: '0.9rem',
                                  fontWeight: '500'
                                }}>
                                  {a.weight}%
                                </span>
                              </div>
                            )}
                            
                            {a.course && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#6b7280' }}>🎓</span>
                                <span style={{ 
                                  color: '#374151',
                                  fontSize: '0.9rem',
                                  fontWeight: '500'
                                }}>
                                  {a.course}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <button 
                          onClick={() => generate(a)} 
                          disabled={buttonDisabled}
                          style={{
                            background: alreadyGenerated
                              ? '#e5e7eb'
                              : isGenerating
                                ? '#f3f4f6'
                                : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                            color: alreadyGenerated || isGenerating ? '#6b7280' : 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0.75rem 1.5rem',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                            boxShadow: alreadyGenerated || isGenerating ? 'none' : '0 4px 12px rgba(79, 70, 229, 0.3)',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {alreadyGenerated ? (
                            <>✅ Already Generated</>
                          ) : isGenerating ? (
                            <>
                              <div style={{
                                width: '16px',
                                height: '16px',
                                border: '2px solid #d1d5db',
                                borderTop: '2px solid #6b7280',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                              }}></div>
                              Generating...
                            </>
                          ) : (
                            <>
                              ✨ Generate Milestones
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {draft && selected && (
            <div style={{
              background: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.1)'
            }}>
              {/* Milestone Header */}
              <div style={{
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                padding: '1.5rem 2rem',
                color: 'white'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '1.5rem' }}>🎯</div>
                  <h3 style={{ 
                    margin: 0,
                    fontSize: '1.3rem',
                    fontWeight: '600'
                  }}>
                    Review Milestones
                  </h3>
                </div>
                <p style={{ 
                  margin: 0,
                  opacity: 0.9,
                  fontSize: '1rem'
                }}>
                  {selected.title} • Click on any field to edit
                </p>
              </div>

              {/* Milestones Table */}
              <div style={{ padding: '0' }}>
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
                          padding: '1.25rem 1.5rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb',
                          fontSize: '0.9rem'
                        }}>
                          📝 MILESTONE TITLE
                        </th>
                        <th style={{ 
                          textAlign: "left",
                          padding: '1.25rem 1.5rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb',
                          fontSize: '0.9rem'
                        }}>
                          📅 TARGET DATE
                        </th>
                        <th style={{ 
                          textAlign: "center",
                          padding: '1.25rem 1.5rem',
                          fontWeight: '600',
                          color: '#374151',
                          borderBottom: '2px solid #e5e7eb',
                          fontSize: '0.9rem'
                        }}>
                          ⏱️ EST. HOURS
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.map((m, i) => (
                        <tr key={i} style={{
                          borderBottom: i < draft.length - 1 ? '1px solid #f3f4f6' : 'none'
                        }}>
                          <td
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => (m.title = e.currentTarget.textContent || m.title)}
                            style={{ 
                              padding: '1.25rem 1.5rem',
                              borderRight: '1px solid #f3f4f6',
                              cursor: 'text',
                              minWidth: '250px',
                              fontWeight: '500',
                              color: '#111827',
                              lineHeight: '1.5'
                            }}
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
                            style={{ 
                              padding: '1.25rem 1.5rem',
                              borderRight: '1px solid #f3f4f6',
                              cursor: 'text',
                              color: '#374151',
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              minWidth: '180px'
                            }}
                          >
                            {new Date(m.targetDate).toLocaleDateString('en-AU', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </td>
                          <td
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const v = e.currentTarget.textContent?.trim();
                              m.estimateHrs = v ? Number(v) : m.estimateHrs;
                            }}
                            style={{ 
                              padding: '1.25rem 1.5rem',
                              cursor: 'text',
                              textAlign: 'center',
                              color: '#374151',
                              fontWeight: '600',
                              fontSize: '1rem'
                            }}
                          >
                            {m.estimateHrs ?? 2}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ 
                padding: '1.5rem 2rem',
                background: '#f9fafb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                  {draft.length} milestone{draft.length !== 1 ? 's' : ''} • Total: {draft.reduce((sum, m) => sum + (m.estimateHrs || 2), 0)} hours estimated
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button 
                    onClick={() => {
                      setDraft(null);
                      setSelected(null);
                    }}
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
                    💾 Save Milestones
                  </button>
                </div>
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
        
        button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.15) !important;
        }
        
        table tbody tr:hover {
          background-color: #f9fafb !important;
        }
      `}</style>
    </div>
  );
}
