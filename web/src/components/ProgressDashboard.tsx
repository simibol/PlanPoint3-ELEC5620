import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type {
  PlannerPreferences,
  PlannedSession,
  Assessment,
  SessionStatus,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  startOfWeek,
  withDefaults,
} from "../lib/planner";

const MS_IN_DAY = 86_400_000;

type NotificationsMode = "none" | "link-only";

type ProgressDashboardProps = {
  allowToggle?: boolean;
  showGreeting?: boolean;
  greetingName?: string | null;
  notificationsMode?: NotificationsMode;
};

const parseDate = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

const formatFullDate = (isoDate: string) =>
  parseDate(isoDate).toLocaleDateString("en-AU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatTime12 = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const period = h >= 12 ? "pm" : "am";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
};

const formatTimeRange = (session: PlannedSession) =>
  `${formatTime12(session.startTime)} – ${formatTime12(session.endTime)}`;

export default function ProgressDashboard({
  allowToggle = true,
  showGreeting = false,
  greetingName,
  notificationsMode = "link-only",
}: ProgressDashboardProps) {
  const uid = auth.currentUser?.uid;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [preferences, setPreferences] =
    useState<PlannerPreferences>(DEFAULT_PREFERENCES);
  const [assessments, setAssessments] = useState<Assessment[]>([]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [planSnap, prefsSnap, assessmentsSnap] = await Promise.all([
          getDocs(collection(db, "users", uid, "planSessions")),
          getDoc(doc(db, "users", uid, "settings", "planner")),
          getDocs(collection(db, "users", uid, "assessments")),
        ]);

        const fetched = planSnap.docs
          .map((d) => d.data() as PlannedSession)
          .map((session) => ({
            ...session,
            status: (session.status as SessionStatus) ?? "planned",
          }))
          .sort((a, b) => {
            const dateDiff = a.date.localeCompare(b.date);
            if (dateDiff !== 0) return dateDiff;
            return a.startTime.localeCompare(b.startTime);
          });
        setSessions(fetched);

        if (prefsSnap.exists()) {
          setPreferences(withDefaults(prefsSnap.data() as PlannerPreferences));
        } else {
          setPreferences(DEFAULT_PREFERENCES);
        }

        setAssessments(
          assessmentsSnap.docs.map((docSnap) => docSnap.data() as Assessment)
        );
      } catch (err: any) {
        console.error("[Progress] load failed:", err);
        setError(err.message || "Failed to load planner data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const toggleStatus = async (session: PlannedSession) => {
    if (!allowToggle || !uid) return;
    const nextStatus: SessionStatus =
      session.status === "completed" ? "planned" : "completed";
    const timestamp = new Date().toISOString();
    try {
      await setDoc(
        doc(db, "users", uid, "planSessions", session.id),
        { status: nextStatus, updatedAt: timestamp },
        { merge: true }
      );
      setSessions((prev) =>
        prev.map((existing) =>
          existing.id === session.id ? { ...existing, status: nextStatus } : existing
        )
      );
    } catch (err: any) {
      console.error("[Progress] toggle failed:", err);
      setError(err.message || "Unable to update session status.");
    }
  };

  const now = useMemo(() => {
    const current = new Date();
    current.setSeconds(0, 0);
    return current;
  }, [sessions.length]);

  const overdueSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status !== "completed" &&
          parseDate(session.date).getTime() < now.getTime()
      ),
    [sessions, now]
  );

  const weekStart = startOfWeek(now);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * MS_IN_DAY)),
    [weekStart]
  );

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, PlannedSession[]>();
    weekDates.forEach((date) => {
      const iso = date.toISOString().slice(0, 10);
      map.set(
        iso,
        sessions
          .filter((session) => session.date === iso)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      );
    });
    return map;
  }, [sessions, weekDates]);

  const upcomingSessions = useMemo(() => {
    const horizon = now.getTime() + MS_IN_DAY;
    return sessions
      .filter((session) => {
        if (session.status === "completed") return false;
        const start = new Date(`${session.date}T${session.startTime}`);
        const epoch = start.getTime();
        return epoch >= now.getTime() && epoch <= horizon;
      })
      .sort(
        (a, b) =>
          new Date(`${a.date}T${a.startTime}`).getTime() -
          new Date(`${b.date}T${b.startTime}`).getTime()
      )
      .slice(0, 3);
  }, [sessions, now]);

  const nextAssessment = useMemo(() => {
    const upcoming = assessments
      .filter((a) => a.dueDate)
      .map((assessment) => ({
        assessment,
        due: new Date(assessment.dueDate!),
      }))
      .filter(({ due }) => due.getTime() >= now.getTime())
      .sort((a, b) => a.due.getTime() - b.due.getTime());
    return upcoming[0] ?? null;
  }, [assessments, now]);

  type SimpleNotification = {
    id: string;
    title: string;
    detail: string;
    link: string;
  };

  const notifications = useMemo<SimpleNotification[]>(() => {
    if (notificationsMode === "none") return [];
    const list: SimpleNotification[] = [];
    upcomingSessions.forEach((session) => {
      list.push({
        id: `session-${session.id}`,
        title: `Starting soon: ${session.subtaskTitle}`,
        detail: `${formatTimeRange(session)} • ${session.assessmentTitle}`,
        link: `/planner?focus=${encodeURIComponent(session.id)}`,
      });
    });
    if (nextAssessment) {
      list.push({
        id: `assessment-${nextAssessment.assessment.title}`,
        title: `Next assessment due: ${nextAssessment.assessment.title}`,
        detail: nextAssessment.due.toLocaleString("en-AU", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
        link: "/planner",
      });
    }
    return list;
  }, [notificationsMode, upcomingSessions, nextAssessment]);

  const currentWeekSessions = useMemo(() => {
    const startMs = weekStart.getTime();
    const endMs = startMs + 7 * MS_IN_DAY;
    return sessions.filter((session) => {
      const date = parseDate(session.date).getTime();
      return date >= startMs && date < endMs;
    });
  }, [sessions, weekStart]);

  const completedThisWeek = currentWeekSessions.filter(
    (session) => session.status === "completed"
  ).length;
  const completionPercent = currentWeekSessions.length
    ? Math.round((completedThisWeek / currentWeekSessions.length) * 100)
    : 100;

  const totalCompletedSessions = sessions.filter(
    (session) => session.status === "completed"
  ).length;
  const overallPercent = sessions.length
    ? Math.round((totalCompletedSessions / sessions.length) * 100)
    : 100;

  if (!uid) return null;

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <p>Loading your progress…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #10b981 0%, #2563eb 100%)",
        padding: "2rem 1.5rem",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 24px 48px rgba(15, 23, 42, 0.16)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "2rem",
            background: "linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%)",
            color: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "14px",
                background: "rgba(255,255,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
              }}
            >
              📈
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "2.15rem" }}>
                {showGreeting
                  ? `Welcome back${greetingName ? `, ${greetingName}` : ""}`
                  : "Progress overview"}
              </h1>
              <p style={{ margin: "0.25rem 0 0 0", opacity: 0.85 }}>
                Track what’s coming up next and stay ahead of deadlines.
              </p>
            </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1.25rem",
            marginTop: "1.5rem",
          }}
        >
          <SummaryTile
            label="Sessions scheduled"
            value={sessions.length.toString()}
            helper="Across all upcoming weeks"
          />
          <SummaryTile
            label="Overdue sessions"
            value={overdueSessions.length.toString()}
            helper={
              overdueSessions.length
                ? "Time to catch up"
                : "All caught up"
            }
          />
          <SummaryTile
            label="Week completion"
            value={`${completionPercent}%`}
            helper={`${completedThisWeek} of ${currentWeekSessions.length || 0} sessions`}
          />
        </div>
        <div
          style={{
            marginTop: "1.75rem",
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <ProgressMeter
            label="Weekly progress"
            percent={completionPercent}
            helper={`${completedThisWeek} completed / ${currentWeekSessions.length || 0} planned`}
          />
          <ProgressMeter
            label="Overall completion"
            percent={overallPercent}
            helper={`${totalCompletedSessions} completed of ${sessions.length} scheduled`}
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

          {notificationsMode !== "none" && (
            <section style={{ marginBottom: "2.5rem" }}>
              <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
                Upcoming reminders
              </h2>
              {!notifications.length ? (
                <p style={{ color: "#475569" }}>
                  Nothing urgent for the next day. Keep an eye on your planner for new items.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {notifications.map((note) => (
                    <NotificationCard key={note.id} note={note} />
                  ))}
                </div>
              )}
            </section>
          )}

          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>
              This week’s plan
            </h2>
            <div style={{ display: "grid", gap: "1rem" }}>
              {weekDates.map((date) => {
                const iso = date.toISOString().slice(0, 10);
                const daySessions = sessionsByDay.get(iso) ?? [];
                return (
                  <DayCard
                    key={iso}
                    date={date}
                    sessions={daySessions}
                    allowToggle={allowToggle}
                    onToggle={toggleStatus}
                  />
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
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
        minWidth: 180,
        padding: "0.9rem 1.1rem",
        borderRadius: "14px",
        background: "rgba(255,255,255,0.18)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontSize: "0.82rem", opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800 }}>{value}</div>
      {helper && (
        <div style={{ fontSize: "0.78rem", opacity: 0.85 }}>{helper}</div>
      )}
    </div>
  );
}

type SimpleNotification = {
  id: string;
  title: string;
  detail: string;
  link: string;
};

function ProgressMeter({
  label,
  percent,
  helper,
}: {
  label: string;
  percent: number;
  helper: string;
}) {
  const safePercent = Math.min(100, Math.max(0, percent));
  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: 14,
        background: "rgba(255,255,255,0.18)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.85)" }}>{label}</div>
      <div
        style={{
          marginTop: "0.6rem",
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: "100%",
            background: "linear-gradient(135deg,#22d3ee,#6366f1)",
          }}
        />
      </div>
      <div
        style={{
          marginTop: "0.5rem",
          display: "flex",
          justifyContent: "space-between",
          color: "white",
          fontSize: "0.82rem",
        }}
      >
        <span>{helper}</span>
        <span>{safePercent}%</span>
      </div>
    </div>
  );
}

function NotificationCard({ note }: { note: SimpleNotification }) {
  return (
    <div
      style={{
        border: "1px solid #bfdbfe",
        background: "#eff6ff",
        color: "#0f172a",
        borderRadius: "12px",
        padding: "0.85rem 1rem",
        display: "grid",
        gap: "0.35rem",
      }}
    >
      <div style={{ fontWeight: 600 }}>{note.title}</div>
      <div style={{ fontSize: "0.85rem" }}>{note.detail}</div>
      <Link
        to={note.link}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.85rem",
          fontWeight: 600,
          color: "#1d4ed8",
        }}
      >
        View in planner →
      </Link>
    </div>
  );
}

function DayCard({
  date,
  sessions,
  allowToggle,
  onToggle,
}: {
  date: Date;
  sessions: PlannedSession[];
  allowToggle: boolean;
  onToggle: (session: PlannedSession) => void;
}) {
  const iso = date.toISOString().slice(0, 10);
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        padding: "1rem",
        background: "#ffffff",
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
        <span style={{ fontWeight: 600, color: "#0f172a" }}>
          {formatFullDate(iso)}
        </span>
        <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
          {sessions.reduce((acc, s) => acc + s.durationHours, 0).toFixed(1)}h
        </span>
      </div>
      {!sessions.length ? (
        <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
          No sessions planned.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.6rem" }}>
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
                <span style={{ fontWeight: 600, color: "#0f172a" }}>
                  {session.subtaskTitle}
                </span>
                <span
                  style={{
                    fontSize: "0.82rem",
                    color: "#0369a1",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTimeRange(session)}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                {session.assessmentTitle}
              </div>
              {session.notes && (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#64748b",
                    marginTop: "0.35rem",
                  }}
                >
                  {session.notes}
                </div>
              )}
              {allowToggle && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    marginTop: "0.45rem",
                    fontSize: "0.78rem",
                    color: "#475569",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={session.status === "completed"}
                    onChange={() => onToggle(session)}
                  />
                  Mark as done
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
