import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  addDoc,
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
  BusyBlock,
  SessionStatus,
  ProgressAudit,
  NotificationItem,
  NotificationState,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  buildWeeklySummaries,
  rescheduleSessions,
  startOfWeek,
  withDefaults,
  generateNotifications,
} from "../lib/planner";

type RescheduleContext = {
  label: string;
  plan: PlanResult;
  original: Map<string, PlannedSession>;
};

type NotificationsMode = "none" | "link-only";

const severityStyles: Record<
  NotificationItem["severity"],
  { bg: string; border: string; text: string }
> = {
  urgent: { bg: "#fee2e2", border: "#fca5a5", text: "#b91c1c" },
  warning: { bg: "#fef3c7", border: "#fcd34d", text: "#b45309" },
  info: { bg: "#e0f2fe", border: "#bae6fd", text: "#0369a1" },
};

type ProgressDashboardProps = {
  allowToggle?: boolean;
  initialAutoCatchup?: boolean;
  showGreeting?: boolean;
  greetingName?: string | null;
  notificationsMode?: NotificationsMode;
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

const normaliseStatus = (status: string | undefined): SessionStatus => {
  if (!status) return "planned";
  const lower = status.toLowerCase();
  if (lower === "complete" || lower === "completed") return "completed";
  if (lower === "in-progress") return "in-progress";
  if (lower === "todo") return "todo";
  return "planned";
};

const progressLabel = (ratio: number): "on-track" | "behind" | "at-risk" => {
  if (ratio >= 0.85) return "on-track";
  if (ratio >= 0.55) return "behind";
  return "at-risk";
};

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

const toIsoString = (value: any) => {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (err) {
      // fall through to default below
    }
  }
  return new Date().toISOString();
};

export default function ProgressDashboard({
  allowToggle = true,
  initialAutoCatchup = false,
  showGreeting = false,
  greetingName,
  notificationsMode = "none",
}: ProgressDashboardProps) {
  const uid = auth.currentUser?.uid;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [preferences, setPreferences] =
    useState<PlannerPreferences>(DEFAULT_PREFERENCES);
  const [rescheduleContext, setRescheduleContext] =
    useState<RescheduleContext | null>(null);
  const [auditEntries, setAuditEntries] = useState<ProgressAudit[]>([]);
  const [notificationStates, setNotificationStates] = useState<NotificationState[]>([]);
  const [autoCatchupPending, setAutoCatchupPending] = useState(initialAutoCatchup);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const planCol = collection(db, "users", uid, "planSessions");
        const prefsDoc = doc(db, "users", uid, "settings", "planner");
        const busyCol = collection(db, "users", uid, "busy");
        const auditCol = collection(db, "users", uid, "progressAudit");
        const stateCol =
          notificationsMode === "none"
            ? null
            : collection(db, "users", uid, "notificationStates");

        const promises: Promise<any>[] = [
          getDocs(planCol),
          getDoc(prefsDoc),
          getDocs(busyCol),
          getDocs(auditCol),
        ];
        if (stateCol) {
          promises.push(getDocs(stateCol));
        }

        const results = await Promise.all(promises);
        const planSnap = results[0];
        const prefSnap = results[1];
        const busySnap = results[2];
        const auditSnap = results[3];
        const stateSnap = stateCol ? results[4] : null;
        const fetched = planSnap.docs
          .map((d) => {
            const data = d.data() as PlannedSession;
            const status = normaliseStatus((data as any).status);
            return { ...data, id: d.id, status };
          })
          .sort((a, b) => {
            const dateDiff =
              parseDate(a.date).getTime() - parseDate(b.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.startTime.localeCompare(b.startTime);
          });
        setSessions(fetched);
        setBusyBlocks(busySnap.docs.map((d) => d.data() as BusyBlock));
        const audits = auditSnap.docs
          .map((d) => {
            const data = d.data() as ProgressAudit;
            return {
              ...data,
              id: d.id,
              createdAt: toIsoString((data as any)?.createdAt),
            };
          })
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          .slice(0, 25);
        setAuditEntries(audits);
        if (stateSnap) {
          setNotificationStates(
            stateSnap.docs.map((d: any) => ({
              id: d.id,
              ...(d.data() as NotificationState),
            }))
          );
        } else {
          setNotificationStates([]);
        }

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

  const recordAudit = useCallback(
    async (entry: Omit<ProgressAudit, "id">) => {
      if (!uid) return;
      try {
        const docRef = await addDoc(
          collection(db, "users", uid, "progressAudit"),
          entry
        );
        setAuditEntries((prev) =>
          [{ ...entry, id: docRef.id }, ...prev].slice(0, 25)
        );
      } catch (err) {
        console.error("[Progress] audit record failed:", err);
      }
    },
    [uid]
  );

  const now = useMemo(() => {
    const current = new Date();
    current.setSeconds(0, 0);
    return current;
  }, []);
  const notifications = useMemo<NotificationItem[]>(
    () =>
      notificationsMode === "none"
        ? []
        : generateNotifications(sessions, notificationStates, now),
    [notificationsMode, sessions, notificationStates, now]
  );
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

  const weekDateList = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const weekDaySessions = useMemo(
    () =>
      weekDateList.map((date) => {
        const iso = formatISODate(date);
        const sessionsForDay = currentWeekSessions
          .filter((session) => session.date === iso)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return { date, iso, sessions: sessionsForDay };
      }),
    [weekDateList, currentWeekSessions]
  );

  const overdueSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status !== "completed" &&
          parseDate(session.date).getTime() < todayKey.getTime()
      ),
    [sessions, todayKey]
  );

  const weeklyTotals = useMemo(() => {
    const planned = currentWeekSessions.reduce(
      (acc, session) => acc + session.durationHours,
      0
    );
    const completed = currentWeekSessions
      .filter((session) => session.status === "completed")
      .reduce((acc, session) => acc + session.durationHours, 0);
    return { planned, completed };
  }, [currentWeekSessions]);

  const overallTotals = useMemo(() => {
    const planned = sessions.reduce(
      (acc, session) => acc + session.durationHours,
      0
    );
    const completed = sessions
      .filter((session) => session.status === "completed")
      .reduce((acc, session) => acc + session.durationHours, 0);
    return { planned, completed };
  }, [sessions]);

  const progressPercent = clampPercent(
    weeklyTotals.planned > 0
      ? (weeklyTotals.completed / weeklyTotals.planned) * 100
      : 100
  );
  const weeklyStatus = progressLabel(
    weeklyTotals.planned > 0
      ? weeklyTotals.completed / weeklyTotals.planned
      : 1
  );

  const semesterPercent = clampPercent(
    overallTotals.planned > 0
      ? (overallTotals.completed / overallTotals.planned) * 100
      : 100
  );
  const semesterStatus = progressLabel(
    overallTotals.planned > 0
      ? overallTotals.completed / overallTotals.planned
      : 1
  );

  const toggleStatus = async (session: PlannedSession) => {
    if (!allowToggle) return;
    if (!uid) return;
    const wasCompleted = session.status === "completed";
    const newStatus: SessionStatus = wasCompleted ? "planned" : "completed";
    const timestamp = new Date().toISOString();
    try {
      const ref = doc(db, "users", uid, "planSessions", session.id);
      await setDoc(
        ref,
        {
          status: newStatus,
          updatedAt: timestamp,
        },
        { merge: true }
      );
      setSessions((prev) =>
        prev.map((item) =>
          item.id === session.id ? { ...item, status: newStatus } : item
        )
      );
      await recordAudit({
        action: "status-change",
        sessionId: session.id,
        sessionTitle: session.subtaskTitle,
        assessmentTitle: session.assessmentTitle,
        beforeStatus: session.status,
        afterStatus: newStatus,
        note: wasCompleted ? "Marked incomplete" : "Marked complete",
        createdAt: timestamp,
      });
    } catch (err: any) {
      console.error("[Progress] toggle failed:", err);
      setError(err.message || "Unable to update session status.");
    }
  };

  const prepareRollForward = useCallback(() => {
    const candidates = currentWeekSessions.filter(
      (session) => session.status !== "completed"
    );
    if (!candidates.length) {
      setSuccess("Nothing to roll—current week is up to date.");
      return;
    }
    const plan = rescheduleSessions(candidates, preferences, {
      startDate: nextWeekStart,
      busyBlocks,
    });
    setRescheduleContext({
      label: "Next-week rollover",
      plan,
      original: new Map(candidates.map((s) => [s.id, s])),
    });
  }, [currentWeekSessions, preferences, nextWeekStart, busyBlocks, setSuccess, setRescheduleContext]);

  const prepareCatchUp = useCallback(() => {
    if (!overdueSessions.length) {
      setSuccess("Great work—no overdue sessions detected.");
      return;
    }
    const plan = rescheduleSessions(overdueSessions, preferences, {
      startDate: todayKey,
      busyBlocks,
    });
    setRescheduleContext({
      label: "Catch-up reschedule",
      plan,
      original: new Map(overdueSessions.map((s) => [s.id, s])),
    });
  }, [overdueSessions, preferences, todayKey, busyBlocks, setSuccess, setRescheduleContext]);

  useEffect(() => {
    if (!autoCatchupPending) return;
    if (loading) return;
    prepareCatchUp();
    setAutoCatchupPending(false);
  }, [autoCatchupPending, loading, prepareCatchUp]);

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
        const normalisedStatus = normaliseStatus((session as any).status);
        const update: PlannedSession = {
          ...session,
          status: normalisedStatus,
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
          const normalisedStatus = normaliseStatus((updated as any).status);
          return {
            ...existing,
            ...updated,
            status: normalisedStatus,
            rolledFromDate:
              prior?.rolledFromDate ?? prior?.date ?? existing.rolledFromDate,
          };
        })
      );
      await recordAudit({
        action: "reschedule",
        createdAt: timestamp,
        note: `${rescheduleContext.label} (${plan.sessions.length} session${
          plan.sessions.length === 1 ? "" : "s"
        }) applied`,
      });
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
          [
            csvSafe(formatDate(summary.startDate)),
            csvSafe(formatDate(summary.endDate)),
            csvSafe(summary.plannedHours.toFixed(1)),
            csvSafe(summary.completedHours.toFixed(1)),
            csvSafe(summary.status),
          ].join(",")
      ),
    ];
    if (auditEntries.length) {
      lines.push("", "Audit Trail", "Timestamp,Action,Session,Assessment,Before Status,After Status,Note");
      auditEntries.forEach((entry) => {
        lines.push(
          [
            csvSafe(entry.createdAt),
            csvSafe(entry.action),
            csvSafe(entry.sessionTitle ?? "-"),
            csvSafe(entry.assessmentTitle ?? "-"),
            csvSafe(entry.beforeStatus ?? "-"),
            csvSafe(entry.afterStatus ?? "-"),
            csvSafe(entry.note ?? "-"),
          ].join(",")
        );
      });
    }
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

  const friendlyName =
    greetingName ?? auth.currentUser?.displayName ?? auth.currentUser?.email ?? "there";
  const headerTitle = showGreeting ? `Hello, ${friendlyName}` : "Progress Tracker";
  const headerSubtitle = showGreeting
    ? "Here’s what’s coming up in your plan."
    : "Check your weekly momentum, mark tasks off, and roll forward what’s left.";

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
                {headerTitle}
              </h1>
              <p style={{ margin: 0, opacity: 0.85, fontSize: "1rem" }}>
                {headerSubtitle}
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
              helper={`${currentWeekSessions.filter((s) => s.status === "completed").length} of ${currentWeekSessions.length} sessions`}
            />
          </div>
          <div
            style={{
              marginTop: "1.25rem",
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            <ProgressBarSummary
              label="Weekly completion"
              percent={progressPercent}
              status={weeklyStatus}
              completed={weeklyTotals.completed}
              planned={weeklyTotals.planned}
            />
            <ProgressBarSummary
              label="Semester completion"
              percent={semesterPercent}
              status={semesterStatus}
              completed={overallTotals.completed}
              planned={overallTotals.planned}
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

          {notificationsMode !== "none" && (
            <section style={{ marginBottom: "2.5rem" }}>
              <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
                Notifications
              </h2>
              {!notifications.length ? (
                <p style={{ color: "#475569" }}>
                  You're all caught up. New reminders will appear here when sessions are approaching.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {notifications.map((note) => (
                    <div
                      key={note.id}
                      style={{
                        border: `1px solid ${severityStyles[note.severity].border}`,
                        background: severityStyles[note.severity].bg,
                        color: severityStyles[note.severity].text,
                        borderRadius: "12px",
                        padding: "0.85rem 1rem",
                        display: "grid",
                        gap: "0.35rem",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{note.title}</div>
                      <div style={{ fontSize: "0.85rem" }}>{note.message}</div>
                      <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                        Due {formatFullDate(note.dueDate)}
                      </div>
                      <div>
                        <Link
                          to={note.sessionId ? `/planner?focus=${encodeURIComponent(note.sessionId)}` : "/planner"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            color: "#0f172a",
                            textDecoration: "underline",
                          }}
                        >
                          View in calendar
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
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
              <EmptyPlannerCallout />
            ) : (
              <div style={{ display: "grid", gap: "1rem" }}>
                {weekDaySessions.map(({ date, iso, sessions }) => (
                  <div
                    key={iso}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "0.9rem",
                      background: "#ffffff",
                    }}
                  >
                    <header
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "0.4rem",
                      }}
                    >
                      <h3 style={{ margin: 0, color: "#0f172a" }}>
                        {formatFullDate(formatISODate(date))}
                      </h3>
                      <span style={{ fontSize: "0.8rem", color: "#475569" }}>
                        {sessions.reduce((acc, s) => acc + s.durationHours, 0).toFixed(1)}h
                      </span>
                    </header>
                    {!sessions.length ? (
                      <p style={{ color: "#64748b", fontSize: "0.85rem" }}>
                        No focus blocks planned for this day.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        {sessions.map((session) => (
                          <div
                            key={session.id}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: 10,
                              padding: "0.75rem",
                              background:
                                session.status === "completed" ? "#ecfdf5" : "#f8fafc",
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
                              <div style={{ fontWeight: 600, color: "#0f172a" }}>
                                {session.subtaskTitle}
                              </div>
                              <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                                {formatTimeRange(session)}
                              </div>
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                              {session.assessmentTitle} • {session.milestoneTitle}
                            </div>
                            {session.notes && (
                              <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.3rem" }}>
                                {session.notes}
                              </div>
                            )}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginTop: "0.45rem",
                                fontSize: "0.78rem",
                                color: "#475569",
                              }}
                            >
                              <span>{session.durationHours.toFixed(1)}h planned</span>
                              {allowToggle ? (
                                <label
                                  style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={session.status === "completed"}
                                    onChange={() => toggleStatus(session)}
                                  />
                                  Done
                                </label>
                              ) : (
                                <StatusBadge status={session.status} />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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

          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
              Recent audit trail
            </h2>
            {!auditEntries.length ? (
              <p style={{ color: "#475569" }}>
                No tracked actions yet. As you mark tasks complete or reschedule, entries will appear here.
              </p>
            ) : (
              <AuditTrail entries={auditEntries.slice(0, 8)} />
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

const STATUS_COLORS: Record<"on-track" | "behind" | "at-risk", { pillBg: string; pillText: string; bar: string }> = {
  "on-track": { pillBg: "#dcfce7", pillText: "#166534", bar: "#16a34a" },
  behind: { pillBg: "#fef3c7", pillText: "#92400e", bar: "#f97316" },
  "at-risk": { pillBg: "#fee2e2", pillText: "#b91c1c", bar: "#ef4444" },
};

function ProgressBarSummary({
  label,
  percent,
  status,
  completed,
  planned,
}: {
  label: string;
  percent: number;
  status: "on-track" | "behind" | "at-risk";
  completed: number;
  planned: number;
}) {
  const palette = STATUS_COLORS[status];
  const safePercent = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderRadius: "12px",
        border: `1px solid ${palette.bar}`,
        background: palette.pillBg,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontWeight: 600, color: palette.pillText }}>{label}</span>
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.2rem 0.45rem",
            borderRadius: "999px",
            background: palette.pillBg,
            color: palette.pillText,
            textTransform: "uppercase",
          }}
        >
          {status.replace("-", " ")}
        </span>
      </div>
      <div
        style={{
          height: "12px",
          borderRadius: "999px",
          background: "#e2f5e9",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: "100%",
            background: palette.bar,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <div
        style={{
          marginTop: "0.6rem",
          fontSize: "0.85rem",
          color: palette.pillText,
        }}
      >
        {completed.toFixed(1)}h of {planned.toFixed(1)}h complete
      </div>
      <div
        style={{
          color: palette.bar,
          fontSize: "0.8rem",
          marginTop: "0.25rem",
          fontWeight: 600,
        }}
      >
        {safePercent}% complete
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  style,
}: {
  status: SessionStatus;
  style?: CSSProperties;
}) {
  const isComplete = status === "completed";
  const colors = isComplete
    ? { bg: "#dcfce7", text: "#166534", label: "Completed" }
    : { bg: "#fef3c7", text: "#92400e", label: "Pending" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.25rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        minWidth: "88px",
        ...style,
      }}
    >
      {colors.label}
    </span>
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

function AuditTrail({ entries }: { entries: ProgressAudit[] }) {
  return (
    <div
      style={{
        border: "1px solid #bae6fd",
        borderRadius: "12px",
        background: "#f0f9ff",
        padding: "1rem",
      }}
    >
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          return (
            <div
              key={entry.id ?? `${entry.action}-${entry.createdAt}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "0.65rem",
                alignItems: "start",
                paddingBottom: "0.65rem",
                borderBottom: isLast ? "none" : "1px solid #e2e8f0",
              }}
            >
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "#0369a1",
                minWidth: "160px",
              }}
            >
              {formatDateTime(entry.createdAt)}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: "#0f172a" }}>
                {entry.action === "status-change" ? "Status change" : "Reschedule"}
              </div>
              {entry.sessionTitle && (
                <div style={{ fontSize: "0.85rem", color: "#0f172a" }}>
                  {entry.sessionTitle}
                  {entry.assessmentTitle ? ` • ${entry.assessmentTitle}` : ""}
                </div>
              )}
              <div style={{ fontSize: "0.8rem", color: "#0369a1", marginTop: "0.2rem" }}>
                {entry.note || "No additional notes"}
              </div>
              {entry.action === "status-change" && (
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.2rem" }}>
                  {`Status: ${entry.beforeStatus ?? "-"} → ${entry.afterStatus ?? "-"}`}
                </div>
              )}
            </div>
            </div>
          );
        })}
      </div>
      {entries.length > 0 && (
        <div style={{ fontSize: "0.75rem", color: "#0369a1", marginTop: "0.5rem" }}>
          Showing {entries.length} most recent entr{entries.length === 1 ? "y" : "ies"}.
        </div>
      )}
    </div>
  );
}

function EmptyPlannerCallout() {
  return (
    <div
      style={{
        border: "1px dashed #38bdf8",
        borderRadius: 16,
        padding: "1.5rem",
        background: "#e0f2fe",
        color: "#0c4a6e",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📝</div>
      <h3 style={{ margin: 0 }}>No sessions yet</h3>
      <p style={{ fontSize: "0.95rem", marginTop: "0.4rem" }}>
        Start by ingesting your timetable or assessment CSV so we can generate milestones and auto-plan your study time.
      </p>
      <Link
        to="/ingest"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: "0.8rem",
          padding: "0.65rem 1.4rem",
          borderRadius: 12,
          background: "#0ea5e9",
          color: "white",
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: "0 12px 24px rgba(14,165,233,0.35)",
        }}
      >
        Go to Ingest
      </Link>
    </div>
  );
}

function formatISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return formatISODate(new Date(iso));
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function csvSafe(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "-";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
