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
  PlannerPreferences,
  PlannedSession,
  PlanResult,
  WeeklyProgress,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  buildWeeklySummaries,
  rescheduleSessions,
  startOfWeek,
  withDefaults,
} from "../lib/planner";

type RescheduleContext = {
  label: string;
  plan: PlanResult;
  original: Map<string, PlannedSession>;
};

const parseDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`);

const formatFullDate = (isoDate: string) =>
  parseDate(isoDate).toLocaleDateString("en-AU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatTimeRange = (session: PlannedSession) =>
  `${session.startTime} – ${session.endTime}`;

export default function Progress() {
  const uid = auth.currentUser?.uid;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [preferences, setPreferences] =
    useState<PlannerPreferences>(DEFAULT_PREFERENCES);
  const [rescheduleContext, setRescheduleContext] =
    useState<RescheduleContext | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const planCol = collection(db, "users", uid, "planSessions");
        const prefsDoc = doc(db, "users", uid, "settings", "planner");
        const [planSnap, prefSnap] = await Promise.all([
          getDocs(planCol),
          getDoc(prefsDoc),
        ]);
        const fetched = planSnap.docs
          .map((d) => {
            const data = d.data() as PlannedSession;
            return { ...data, id: d.id };
          })
          .sort((a, b) => {
            const dateDiff =
              parseDate(a.date).getTime() - parseDate(b.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.startTime.localeCompare(b.startTime);
          });
        setSessions(fetched);

        if (prefSnap.exists()) {
          setPreferences(withDefaults(prefSnap.data() as PlannerPreferences));
        } else {
          setPreferences(DEFAULT_PREFERENCES);
        }
      } catch (err: any) {
        console.error("[Progress] load failed:", err);
        setError(err.message || "Failed to load planner data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const now = new Date();
  now.setSeconds(0, 0);
  const todayKey = parseDate(formatISODate(now));
  const weekStart = startOfWeek(now);
  const nextWeekStart = addDays(weekStart, 7);

  const summaries = useMemo<WeeklyProgress[]>(
    () => buildWeeklySummaries(sessions, now),
    [sessions, now]
  );

  const currentWeekSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const date = parseDate(session.date);
        return (
          date.getTime() >= weekStart.getTime() &&
          date.getTime() < nextWeekStart.getTime()
        );
      }),
    [sessions, weekStart, nextWeekStart]
  );

  const overdueSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status !== "complete" &&
          parseDate(session.date).getTime() < todayKey.getTime()
      ),
    [sessions, todayKey]
  );

  const progressPercent = (() => {
    const total = currentWeekSessions.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );
    const done = currentWeekSessions
      .filter((s) => s.status === "complete")
      .reduce((acc, s) => acc + s.durationHours, 0);
    return total > 0 ? Math.round((done / total) * 100) : 100;
  })();

  const toggleStatus = async (session: PlannedSession) => {
    if (!uid) return;
    const newStatus = session.status === "complete" ? "pending" : "complete";
    try {
      const ref = doc(db, "users", uid, "planSessions", session.id);
      await setDoc(
        ref,
        {
          status: newStatus,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setSessions((prev) =>
        prev.map((item) =>
          item.id === session.id ? { ...item, status: newStatus } : item
        )
      );
    } catch (err: any) {
      console.error("[Progress] toggle failed:", err);
      setError(err.message || "Unable to update session status.");
    }
  };

  const prepareRollForward = () => {
    const candidates = currentWeekSessions.filter(
      (session) => session.status !== "complete"
    );
    if (!candidates.length) {
      setSuccess("Nothing to roll—current week is up to date.");
      return;
    }
    const plan = rescheduleSessions(candidates, preferences, {
      startDate: nextWeekStart,
    });
    setRescheduleContext({
      label: "Next-week rollover",
      plan,
      original: new Map(candidates.map((s) => [s.id, s])),
    });
  };

  const prepareCatchUp = () => {
    if (!overdueSessions.length) {
      setSuccess("Great work—no overdue sessions detected.");
      return;
    }
    const plan = rescheduleSessions(overdueSessions, preferences, {
      startDate: todayKey,
    });
    setRescheduleContext({
      label: "Catch-up reschedule",
      plan,
      original: new Map(overdueSessions.map((s) => [s.id, s])),
    });
  };

  const applyReschedule = async () => {
    if (!uid || !rescheduleContext) return;
    const { plan, original } = rescheduleContext;
    if (!plan.sessions.length) {
      setSuccess("No sessions could be reassigned. Adjust your preferences.");
      setRescheduleContext(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const colRef = collection(db, "users", uid, "planSessions");
      const timestamp = new Date().toISOString();

      plan.sessions.forEach((session) => {
        const prior = original.get(session.id);
        const update: PlannedSession = {
          ...session,
          rolledFromDate: prior?.rolledFromDate ?? prior?.date ?? session.rolledFromDate,
          updatedAt: timestamp,
        };
        batch.set(doc(colRef, session.id), update, { merge: true });
      });

      await batch.commit();
      setSessions((prev) =>
        prev.map((existing) => {
          const updated = plan.sessions.find((s) => s.id === existing.id);
          if (!updated) return existing;
          const prior = original.get(existing.id);
          return {
            ...existing,
            ...updated,
            rolledFromDate:
              prior?.rolledFromDate ?? prior?.date ?? existing.rolledFromDate,
          };
        })
      );
      setSuccess(`${rescheduleContext.label} applied.`);
      setRescheduleContext(null);
    } catch (err: any) {
      console.error("[Progress] reschedule apply failed:", err);
      setError(err.message || "Unable to apply the updated plan.");
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    const lines = [
      "Week Start,Week End,Planned Hours,Completed Hours,Status",
      ...summaries.map(
        (summary) =>
          `${formatDate(summary.startDate)},${formatDate(summary.endDate)},${summary.plannedHours.toFixed(
            1
          )},${summary.completedHours.toFixed(1)},${summary.status}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `planpoint-weekly-report-${formatISODate(now)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSuccess("Weekly progress report downloaded.");
  };

  if (!uid) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Progress Tracker</h2>
        <p>Please sign in to view your progress.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Progress Tracker</h2>
        <p>Loading plan data…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #10b981 0%, #14b8a6 100%)",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 22px 45px rgba(20,184,166,0.2)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            background: "linear-gradient(135deg, #0f766e 0%, #047857 100%)",
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
              📈
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
                Progress Tracker
              </h1>
              <p style={{ margin: 0, opacity: 0.85, fontSize: "1rem" }}>
                Check your weekly momentum, mark tasks off, and roll forward what’s
                left.
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
              label="Sessions scheduled"
              value={sessions.length.toString()}
              helper="Across all upcoming weeks"
            />
            <MetricTile
              label="Overdue sessions"
              value={overdueSessions.length.toString()}
              helper="Catch up to stay on track"
            />
            <MetricTile
              label="Current week progress"
              value={`${progressPercent}%`}
              helper={`${currentWeekSessions.filter((s) => s.status === "complete").length} of ${currentWeekSessions.length} sessions`}
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
          {success && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "10px",
                background: "#ecfdf5",
                color: "#047857",
                marginBottom: "1.5rem",
              }}
            >
              {success}
            </div>
          )}

          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
              Weekly overview
            </h2>
            {!sessions.length ? (
              <p style={{ color: "#475569" }}>
                Apply a schedule in the Planner first to track progress.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "1rem",
                }}
              >
                {summaries.slice(0, 6).map((summary) => (
                  <WeeklyCard key={summary.weekLabel} summary={summary} />
                ))}
              </div>
            )}
          </section>

          <section style={{ marginBottom: "2.5rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1rem",
              }}
            >
              <h2 style={{ margin: 0, color: "#0f172a" }}>This week’s plan</h2>
              <button
                onClick={downloadReport}
                style={{
                  padding: "0.6rem 1.25rem",
                  background: "#cffafe",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Download Weekly Report
              </button>
            </div>
            {!currentWeekSessions.length ? (
              <p style={{ color: "#475569" }}>
                No sessions scheduled this week. Run the planner to populate new
                blocks.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "1rem" }}>
                {currentWeekSessions.map((session) => (
                  <div
                    key={session.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "0.9rem",
                      display: "flex",
                      gap: "1rem",
                      alignItems: "flex-start",
                      background:
                        session.status === "complete" ? "#ecfdf5" : "white",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={session.status === "complete"}
                      onChange={() => toggleStatus(session)}
                      style={{ marginTop: "0.4rem" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "0.4rem",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            color: "#0f172a",
                            fontSize: "1rem",
                          }}
                        >
                          {session.subtaskTitle}
                        </h3>
                        <span
                          style={{
                            fontSize: "0.85rem",
                            color: "#334155",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatTimeRange(session)} • {formatFullDate(session.date)}
                        </span>
                      </div>
                      <div
                        style={{
                          color: "#475569",
                          fontSize: "0.85rem",
                          marginBottom: "0.35rem",
                        }}
                      >
                        {session.assessmentTitle} • {session.milestoneTitle}
                      </div>
                      {session.notes && (
                        <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
                          {session.notes}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
              Automation actions
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <ActionButton
                label="Roll incomplete to next week"
                description="Moves unfinished sessions into next week while keeping order."
                icon="🔁"
                onClick={prepareRollForward}
              />
              <ActionButton
                label="Auto catch-up reschedule"
                description="Reallocates overdue sessions from today onward."
                icon="⚡️"
                onClick={prepareCatchUp}
              />
            </div>
            {!!overdueSessions.length && (
              <p style={{ marginTop: "0.75rem", color: "#b91c1c" }}>
                {overdueSessions.length} overdue session
                {overdueSessions.length === 1 ? "" : "s"} detected. Consider running the catch-up.
              </p>
            )}
          </section>

          {rescheduleContext && (
            <section style={{ marginBottom: "2.5rem" }}>
              <div
                style={{
                  border: "1px solid #bae6fd",
                  borderRadius: "12px",
                  background: "#f0f9ff",
                  padding: "1.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, color: "#0c4a6e" }}>
                      {rescheduleContext.label} preview
                    </h2>
                    <p style={{ margin: "0.25rem 0 0 0", color: "#0c4a6e" }}>
                      Review the proposed updates before applying them to your calendar.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      onClick={() => setRescheduleContext(null)}
                      style={{
                        padding: "0.6rem 1.25rem",
                        border: "1px solid #94a3b8",
                        borderRadius: "10px",
                        background: "white",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={applyReschedule}
                      disabled={busy}
                      style={{
                        padding: "0.6rem 1.5rem",
                        borderRadius: "10px",
                        border: "none",
                        background: busy ? "#cbd5f5" : "#0284c7",
                        color: "white",
                        fontWeight: 600,
                        cursor: busy ? "not-allowed" : "pointer",
                        boxShadow: busy
                          ? "none"
                          : "0 12px 24px rgba(2,132,199,0.3)",
                      }}
                    >
                      {busy ? "Applying…" : "Apply changes"}
                    </button>
                  </div>
                </div>

                {!!rescheduleContext.plan.warnings.length && (
                  <div
                    style={{
                      marginBottom: "1rem",
                      padding: "0.75rem",
                      borderRadius: "8px",
                      background: "#fef3c7",
                      color: "#92400e",
                    }}
                  >
                    <strong>Warnings:</strong>
                    <ul style={{ margin: "0.5rem 0 0 1.2rem" }}>
                      {rescheduleContext.plan.warnings.map((warn, idx) => (
                        <li key={idx}>{warn.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gap: "1rem",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  }}
                >
                  {rescheduleContext.plan.days.map((day) => (
                    <div
                      key={day.date}
                      style={{
                        border: "1px solid #bae6fd",
                        borderRadius: "12px",
                        background: "#fff",
                        padding: "1rem",
                      }}
                    >
                      <header
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <span
                          style={{ fontWeight: 600, color: "#0f172a" }}
                        >
                          {formatFullDate(day.date)}
                        </span>
                        <span
                          style={{
                            color: "#0369a1",
                            fontSize: "0.82rem",
                          }}
                        >
                          {day.totalHours.toFixed(1)}h / {day.capacity.toFixed(1)}h
                        </span>
                      </header>
                      {day.sessions.length === 0 ? (
                        <p style={{ color: "#64748b", fontSize: "0.85rem" }}>
                          No sessions.
                        </p>
                      ) : (
                        <div style={{ display: "grid", gap: "0.6rem" }}>
                          {day.sessions.map((session) => {
                            const prior =
                              rescheduleContext.original.get(session.id);
                            return (
                              <div
                                key={session.id}
                                style={{
                                  borderRadius: "10px",
                                  border: "1px solid #e2e8f0",
                                  padding: "0.6rem",
                                  background: "#f8fafc",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    marginBottom: "0.35rem",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: "#0f172a",
                                      fontSize: "0.95rem",
                                    }}
                                  >
                                    {session.subtaskTitle}
                                  </span>
                                  <span
                                    style={{
                                      color: "#0369a1",
                                      fontSize: "0.82rem",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {formatTimeRange(session)}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    color: "#475569",
                                    fontSize: "0.8rem",
                                    marginBottom: "0.3rem",
                                  }}
                                >
                                  {session.assessmentTitle}
                                </div>
                                {prior && (
                                  <div
                                    style={{
                                      color: "#b91c1c",
                                      fontSize: "0.75rem",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    Previously: {formatFullDate(prior.date)}{" "}
                                    ({formatTimeRange(prior)})
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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

function WeeklyCard({ summary }: { summary: WeeklyProgress }) {
  const progress =
    summary.plannedHours > 0
      ? Math.round((summary.completedHours / summary.plannedHours) * 100)
      : 100;
  const color =
    summary.status === "on-track"
      ? "#10b981"
      : summary.status === "behind"
      ? "#f97316"
      : "#ef4444";
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        padding: "1rem",
        background: "#ffffff",
      }}
    >
      <h3 style={{ margin: "0 0 0.35rem 0", color: "#0f172a", fontSize: "1rem" }}>
        Week of {formatDate(summary.startDate)}
      </h3>
      <div style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "0.6rem" }}>
        Planned {summary.plannedHours.toFixed(1)}h • Completed {summary.completedHours.toFixed(1)}h
      </div>
      <div
        style={{
          height: "10px",
          borderRadius: "999px",
          background: "#f1f5f9",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(progress, 100)}%`,
            height: "100%",
            background: color,
          }}
        />
      </div>
      <div
        style={{
          marginTop: "0.5rem",
          color,
          fontSize: "0.8rem",
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        {summary.status.replace("-", " ")}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "1 1 260px",
        border: "1px solid #a7f3d0",
        background: "#ecfdf5",
        color: "#064e3b",
        borderRadius: "12px",
        padding: "1rem",
        textAlign: "left",
        cursor: "pointer",
        transition: "transform 0.2s ease",
      }}
    >
      <div style={{ fontSize: "1.2rem", marginBottom: "0.35rem" }}>{icon}</div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "0.85rem", color: "#047857" }}>{description}</div>
    </button>
  );
}

function formatISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return formatISODate(new Date(iso));
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
