import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type {
  Assessment,
  Milestone,
  PlannerPreferences,
  PlanResult,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  planMilestones,
  withDefaults,
} from "../lib/planner";

const formatLongDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatShortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export default function Planner() {
  const uid = auth.currentUser?.uid;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [preferences, setPreferences] = useState<PlannerPreferences>(
    DEFAULT_PREFERENCES
  );
  const [prefDirty, setPrefDirty] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [activePlanCount, setActivePlanCount] = useState(0);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const assessmentsCol = collection(db, "users", uid, "assessments");
        const milestonesCol = collection(db, "users", uid, "milestones");
        const planCol = collection(db, "users", uid, "planSessions");
        const settingsDoc = doc(db, "users", uid, "settings", "planner");

        const [assSnap, mileSnap, planSnap, prefsSnap] = await Promise.all([
          getDocs(assessmentsCol),
          getDocs(milestonesCol),
          getDocs(planCol),
          getDoc(settingsDoc),
        ]);

        setAssessments(assSnap.docs.map((d) => d.data() as Assessment));
        setMilestones(mileSnap.docs.map((d) => d.data() as Milestone));
        setActivePlanCount(planSnap.size);
        const firstPlan = planSnap.docs[0]?.data() as
          | { version?: number }
          | undefined;
        setActiveVersion(firstPlan?.version ?? null);

        if (prefsSnap.exists()) {
          const stored = prefsSnap.data() as PlannerPreferences;
          setPreferences(withDefaults(stored));
        } else {
          setPreferences(DEFAULT_PREFERENCES);
        }
      } catch (err: any) {
        console.error("[Planner] failed to load:", err);
        setError(err.message || "Failed to load planner data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const milestonesByAssessment = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    milestones.forEach((m) => {
      if (!map.has(m.assessmentTitle)) map.set(m.assessmentTitle, []);
      map.get(m.assessmentTitle)!.push(m);
    });
    return map;
  }, [milestones]);

  useEffect(() => {
    if (!plan) return;
    setSuccessMessage(null);
  }, [plan]);

  const updatePref = <K extends keyof PlannerPreferences>(
    key: K,
    value: PlannerPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setPrefDirty(true);
  };

  const handleGenerate = async () => {
    if (!milestones.length) {
      alert("Add milestones first via UC2.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = planMilestones(milestones, assessments, preferences, {
        startDate: new Date(),
      });
      setPlan(result);
      setSuccessMessage("Auto-plan generated. Review and apply when ready.");
    } catch (err: any) {
      console.error("[Planner] generate failed:", err);
      setError(err.message || "Failed to generate a plan.");
    } finally {
      setBusy(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!uid) return;
    try {
      await setDoc(
        doc(db, "users", uid, "settings", "planner"),
        preferences,
        { merge: true }
      );
      setPrefDirty(false);
      setSuccessMessage("Preferences saved.");
    } catch (err: any) {
      console.error("[Planner] save preferences failed:", err);
      setError(err.message || "Unable to save preferences.");
    }
  };

  const handleApply = async () => {
    if (!uid || !plan) return;
    if (!plan.sessions.length) {
      alert("Generate a plan with at least one session before applying.");
      return;
    }
    const confirmReplace =
      activePlanCount === 0 ||
      window.confirm(
        "This will replace your existing calendar plan. Continue?"
      );
    if (!confirmReplace) return;

    setBusy(true);
    setError(null);
    try {
      const planCol = collection(db, "users", uid, "planSessions");
      const existing = await getDocs(planCol);
      const batch = writeBatch(db);
      existing.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      plan.sessions.forEach((session) => {
        batch.set(doc(planCol, session.id), session);
      });
      await batch.commit();
      await handleSavePreferences();
      setActivePlanCount(plan.sessions.length);
      setActiveVersion(plan.version);
      setSuccessMessage(
        `Plan applied (${plan.sessions.length} sessions scheduled).`
      );
    } catch (err: any) {
      console.error("[Planner] apply failed:", err);
      setError(err.message || "Failed to apply the plan.");
    } finally {
      setBusy(false);
    }
  };

  if (!uid) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Planner</h2>
        <p>Please sign in to access the planner.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Planner</h2>
        <p>Loading planner data…</p>
      </div>
    );
  }

  const currentWeekLoad = plan
    ? plan.days
        .filter((d) => d.sessions.length > 0)
        .slice(0, 7)
        .reduce((acc, day) => acc + day.totalHours, 0)
    : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 22px 45px rgba(14,165,233,0.2)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
            padding: "2rem",
            color: "white",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "14px",
                background: "rgba(255,255,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "26px",
              }}
            >
              🗓️
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "2.1rem",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                }}
              >
                Auto Planner
              </h1>
              <p style={{ margin: 0, opacity: 0.85, fontSize: "1rem" }}>
                Balance workload across assessments with personalised focus
                blocks.
              </p>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              marginTop: "1rem",
            }}
          >
            <MetricTile
              label="Milestones ready"
              value={milestones.length.toString()}
              helper="Generated via UC2"
            />
            <MetricTile
              label="Active plan sessions"
              value={activePlanCount.toString()}
              helper={
                activeVersion
                  ? `Version ${activeVersion}`
                  : "No plan applied"
              }
            />
            <MetricTile
              label="Preview hours (week 1)"
              value={`${currentWeekLoad.toFixed(1)}h`}
              helper="First week of generated plan"
            />
          </div>
        </header>

        <div style={{ padding: "2rem" }}>
          {error && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "10px",
                background: "#fee2e2",
                color: "#b91c1c",
                marginBottom: "1.5rem",
              }}
            >
              {error}
            </div>
          )}

          {successMessage && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "10px",
                background: "#ecfdf5",
                color: "#047857",
                marginBottom: "1.5rem",
              }}
            >
              {successMessage}
            </div>
          )}

          <section style={{ marginBottom: "2.5rem" }}>
            <h2
              style={{
                margin: "0 0 1rem 0",
                fontSize: "1.4rem",
                color: "#0f172a",
              }}
            >
              Preferences
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1.25rem",
                marginBottom: "1.5rem",
              }}
            >
              <NumericField
                label="Daily focus cap (hours)"
                value={preferences.dailyCapHours}
                onChange={(val) => updatePref("dailyCapHours", val)}
                min={1}
                max={12}
              />
              <NumericField
                label="Min session (min)"
                value={preferences.minSessionMinutes}
                onChange={(val) => updatePref("minSessionMinutes", val)}
                min={15}
                max={180}
                step={5}
              />
              <NumericField
                label="Max session (min)"
                value={preferences.maxSessionMinutes}
                onChange={(val) => updatePref("maxSessionMinutes", val)}
                min={30}
                max={240}
                step={5}
              />
              <NumericField
                label="Break between blocks (min)"
                value={preferences.focusBlockMinutes}
                onChange={(val) => updatePref("focusBlockMinutes", val)}
                min={5}
                max={45}
                step={5}
              />
              <NumericField
                label="Start hour"
                value={preferences.startHour}
                onChange={(val) => updatePref("startHour", val)}
                min={5}
                max={12}
              />
              <NumericField
                label="End hour"
                value={preferences.endHour}
                onChange={(val) => updatePref("endHour", val)}
                min={13}
                max={23}
              />
              <ToggleField
                label="Allow weekend sessions"
                checked={preferences.allowWeekends}
                onChange={(val) => updatePref("allowWeekends", val)}
              />
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={handleSavePreferences}
                disabled={!prefDirty || busy}
                style={{
                  padding: "0.75rem 1.5rem",
                  background: prefDirty ? "#0ea5e9" : "#bfdbfe",
                  color: prefDirty ? "white" : "#1d4ed8",
                  border: "none",
                  borderRadius: "10px",
                  cursor: prefDirty && !busy ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                {busy ? "Saving…" : "Save Preferences"}
              </button>
              <button
                onClick={handleGenerate}
                disabled={busy || !milestones.length}
                style={{
                  padding: "0.75rem 1.8rem",
                  background: busy
                    ? "#e5e7eb"
                    : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                  color: busy ? "#6b7280" : "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor:
                    busy || !milestones.length ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  boxShadow: busy
                    ? "none"
                    : "0 12px 30px rgba(99,102,241,0.35)",
                }}
              >
                {busy ? "Planning…" : "Generate Plan"}
              </button>
            </div>
          </section>

          <section style={{ marginBottom: "2.5rem" }}>
            <h2
              style={{
                margin: "0 0 1rem 0",
                fontSize: "1.4rem",
                color: "#0f172a",
              }}
            >
              Milestones overview
            </h2>
            {!milestones.length ? (
              <p style={{ color: "#475569" }}>
                No milestones detected. Generate them in UC2 before running the
                planner.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "1rem",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                }}
              >
                {Array.from(milestonesByAssessment.entries()).map(
                  ([assessmentTitle, entries]) => {
                    const assessment = assessments.find(
                      (a) => a.title === assessmentTitle
                    );
                    const totalHours = entries.reduce(
                      (acc, m) => acc + (m.estimateHrs ?? 0),
                      0
                    );
                    return (
                      <div
                        key={assessmentTitle}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "12px",
                          padding: "1rem",
                          background: "#f8fafc",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1.05rem",
                            color: "#1e293b",
                          }}
                        >
                          {assessmentTitle}
                        </h3>
                        <p
                          style={{
                            margin: "0.25rem 0 0.75rem 0",
                            color: "#475569",
                            fontSize: "0.9rem",
                          }}
                        >
                          Due {formatLongDate(entries[0].assessmentDueDate || assessment?.dueDate || entries[0].targetDate)}
                          {assessment?.weight ? ` • Weight ${assessment.weight}%` : ""}
                        </p>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: "1.1rem",
                            color: "#1f2937",
                            fontSize: "0.9rem",
                          }}
                        >
                          {entries.map((m) => (
                            <li key={`${assessmentTitle}-${m.title}`}>
                              {m.title}{" "}
                              <span style={{ color: "#6b7280" }}>
                                ({(m.estimateHrs ?? 2).toFixed(1)}h • due{" "}
                                {formatShortDate(m.targetDate)})
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div
                          style={{
                            marginTop: "0.75rem",
                            fontSize: "0.85rem",
                            color: "#6366f1",
                            fontWeight: 600,
                          }}
                        >
                          Total focus time: {totalHours.toFixed(1)}h
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </section>

          {plan && (
            <section style={{ marginBottom: "2.5rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  marginBottom: "1.25rem",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: "1.4rem",
                    color: "#0f172a",
                  }}
                >
                  Calendar preview
                </h2>
                <span style={{ color: "#64748b" }}>
                  Version {plan.version} • {plan.sessions.length} sessions
                </span>
              </div>

              {!!plan.warnings.length && (
                <div
                  style={{
                    marginBottom: "1.5rem",
                    borderRadius: "10px",
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    padding: "1rem",
                    color: "#92400e",
                  }}
                >
                  <strong>Heads-up:</strong>
                  <ul style={{ margin: "0.5rem 0 0 1.2rem" }}>
                    {plan.warnings.map((warn, idx) => (
                      <li key={idx} style={{ marginBottom: "0.25rem" }}>
                        {warn.message}
                        {warn.detail ? ` — ${warn.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gap: "1rem",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                }}
              >
                {plan.days.map((day) => (
                  <div
                    key={day.date}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "1rem",
                      background: "#ffffff",
                      boxShadow: day.sessions.length
                        ? "0 6px 16px rgba(148,163,184,0.12)"
                        : "none",
                    }}
                  >
                    <header
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "#0f172a",
                            fontSize: "1rem",
                          }}
                        >
                          {formatLongDate(day.date)}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
                          {day.totalHours.toFixed(1)}h / {day.capacity.toFixed(1)}h
                        </div>
                      </div>
                      {day.isWeekend && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "#f97316",
                            fontWeight: 600,
                          }}
                        >
                          Weekend
                        </span>
                      )}
                    </header>

                    {day.sessions.length === 0 ? (
                      <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                        No sessions scheduled.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        {day.sessions.map((session) => (
                          <div
                            key={session.id}
                            style={{
                              borderRadius: "10px",
                              padding: "0.75rem",
                              border: "1px solid #e2e8f0",
                              background: session.riskLevel === "on-track"
                                ? "#f1f5f9"
                                : session.riskLevel === "warning"
                                ? "#fef3c7"
                                : "#fee2e2",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "0.35rem",
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "#111827",
                                  fontSize: "0.95rem",
                                }}
                              >
                                {session.subtaskTitle}
                              </span>
                              <span
                                style={{
                                  fontSize: "0.82rem",
                                  color: "#334155",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {session.startTime} – {session.endTime}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#475569",
                                marginBottom: "0.35rem",
                              }}
                            >
                              {session.assessmentTitle} • {session.milestoneTitle}
                            </div>
                            {session.notes && (
                              <div
                                style={{
                                  fontSize: "0.78rem",
                                  color: "#64748b",
                                }}
                              >
                                {session.notes}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {!!plan.unplaced.length && (
                <div
                  style={{
                    marginTop: "1.5rem",
                    border: "1px dashed #fca5a5",
                    borderRadius: "12px",
                    padding: "1rem",
                    background: "#fff1f2",
                    color: "#b91c1c",
                  }}
                >
                  <strong>Unplaced tasks:</strong>
                  <ul style={{ marginTop: "0.5rem" }}>
                    {plan.unplaced.map((session) => (
                      <li key={session.id}>
                        {session.subtaskTitle} (needs {session.durationHours.toFixed(1)}h before{" "}
                        {formatShortDate(session.assessmentDueDate)})
                      </li>
                    ))}
                  </ul>
                  <p style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                    Increase daily capacity, expand working window, or allow weekends to
                    place these automatically.
                  </p>
                </div>
              )}

              <div
                style={{
                  marginTop: "2rem",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "1rem",
                }}
              >
                <button
                  onClick={() => setPlan(null)}
                  style={{
                    padding: "0.8rem 1.6rem",
                    border: "1px solid #cbd5e1",
                    background: "white",
                    color: "#475569",
                    borderRadius: "10px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Clear Preview
                </button>
                <button
                  onClick={handleApply}
                  disabled={busy}
                  style={{
                    padding: "0.8rem 2rem",
                    background: busy
                      ? "#e2e8f0"
                      : "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                    color: busy ? "#64748b" : "white",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    boxShadow: busy
                      ? "none"
                      : "0 14px 32px rgba(14,165,233,0.35)",
                  }}
                >
                  {busy ? "Applying…" : "Apply to Calendar"}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderRadius: "12px",
        background: "rgba(255,255,255,0.14)",
        backdropFilter: "blur(6px)",
        minWidth: "160px",
      }}
    >
      <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{value}</div>
      {helper && (
        <div style={{ fontSize: "0.76rem", opacity: 0.8 }}>{helper}</div>
      )}
    </div>
  );
}

function NumericField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        fontSize: "0.9rem",
        color: "#0f172a",
      }}
    >
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          padding: "0.65rem 0.75rem",
          borderRadius: "8px",
          border: "1px solid #cbd5e1",
          fontSize: "0.95rem",
        }}
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        fontSize: "0.9rem",
        color: "#0f172a",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
