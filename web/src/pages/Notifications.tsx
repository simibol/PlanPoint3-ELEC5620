import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { Link } from "react-router-dom";
import { auth, db } from "../firebase";
import type {
  NotificationItem,
  NotificationState,
  PlannedSession,
  PlannerPreferences,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  generateNotifications,
  withDefaults,
} from "../lib/planner";

const parseDate = (iso: string) => new Date(`${iso}T00:00:00`);

const severityStyles: Record<
  NotificationItem["severity"],
  { bg: string; border: string; text: string }
> = {
  urgent: { bg: "#fee2e2", border: "#fca5a5", text: "#b91c1c" },
  warning: { bg: "#fef3c7", border: "#fcd34d", text: "#b45309" },
  info: { bg: "#e0f2fe", border: "#bae6fd", text: "#0369a1" },
};

export default function Notifications() {
  const uid = auth.currentUser?.uid;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [states, setStates] = useState<NotificationState[]>([]);
  const [preferences, setPreferences] =
    useState<PlannerPreferences>(DEFAULT_PREFERENCES);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const planCol = collection(db, "users", uid, "planSessions");
        const stateCol = collection(db, "users", uid, "notificationStates");
        const settingsDoc = doc(db, "users", uid, "settings", "planner");
        const [planSnap, stateSnap, prefsSnap] = await Promise.all([
          getDocs(planCol),
          getDocs(stateCol),
          getDoc(settingsDoc),
        ]);

        const fetchedSessions = planSnap.docs
          .map((d) => ({ ...(d.data() as PlannedSession), id: d.id }))
          .sort((a, b) => {
            const dateDiff =
              parseDate(a.date).getTime() - parseDate(b.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.startTime.localeCompare(b.startTime);
          });
        setSessions(fetchedSessions);

        setStates(
          stateSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as NotificationState),
          }))
        );

        if (prefsSnap.exists()) {
          setPreferences(withDefaults(prefsSnap.data() as PlannerPreferences));
        } else {
          setPreferences(DEFAULT_PREFERENCES);
        }
      } catch (err: any) {
        console.error("[Notifications] load failed:", err);
        setError(err.message || "Unable to load notifications.");
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const now = useMemo(() => new Date(), []);
  const notifications = useMemo(
    () => generateNotifications(sessions, states, now),
    [sessions, states, now]
  );

  const handleDismiss = async (notification: NotificationItem) => {
    if (!uid) return;
    try {
      await setDoc(
        doc(db, "users", uid, "notificationStates", notification.id),
        { id: notification.id, dismissedAt: new Date().toISOString() },
        { merge: true }
      );
      setStates((prev) => {
        const next = prev.filter((s) => s.id !== notification.id);
        next.push({
          id: notification.id,
          dismissedAt: new Date().toISOString(),
        });
        return next;
      });
    } catch (err: any) {
      console.error("[Notifications] dismiss failed:", err);
      setError(err.message || "Unable to dismiss notification.");
    }
  };

  const handleSnooze = async (
    notification: NotificationItem,
    hours: number
  ) => {
    if (!uid) return;
    const snoozeUntil = new Date(Date.now() + hours * 3_600_000).toISOString();
    try {
      await setDoc(
        doc(db, "users", uid, "notificationStates", notification.id),
        { id: notification.id, snoozedUntil: snoozeUntil },
        { merge: true }
      );
      setStates((prev) => {
        const next = prev.filter((s) => s.id !== notification.id);
        next.push({ id: notification.id, snoozedUntil });
        return next;
      });
      setSuccess(`Snoozed "${notification.title}" until ${formatDateTime(
        snoozeUntil
      )}.`);
    } catch (err: any) {
      console.error("[Notifications] snooze failed:", err);
      setError(err.message || "Unable to snooze notification.");
    }
  };

  const markSessionComplete = async (notification: NotificationItem) => {
    if (!uid || !notification.sessionId) return;
    try {
      const ref = doc(db, "users", uid, "planSessions", notification.sessionId);
      await setDoc(
        ref,
        { status: "complete", updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setSessions((prev) =>
        prev.map((session) =>
          session.id === notification.sessionId
            ? { ...session, status: "complete" }
            : session
        )
      );
      await handleDismiss(notification);
      setSuccess(`Marked "${notification.title}" as complete.`);
    } catch (err: any) {
      console.error("[Notifications] complete failed:", err);
      setError(err.message || "Unable to update session.");
    }
  };

  if (!uid) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Notifications & Reminders</h2>
        <p>Sign in to see upcoming reminders.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Notifications & Reminders</h2>
        <p>Loading notifications…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 22px 45px rgba(249,115,22,0.25)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            background: "linear-gradient(135deg, #ea580c 0%, #dc2626 100%)",
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
              🔔
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
                Notifications & Reminders
              </h1>
              <p style={{ margin: 0, opacity: 0.85, fontSize: "1rem" }}>
                Daily digest of pending sessions and deadlines.
              </p>
            </div>
          </div>
          <div style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            Planner windows: {preferences.startHour}:00 – {preferences.endHour}:00 •
            Daily cap {preferences.dailyCapHours}h
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
                background: "#fef3c7",
                color: "#b45309",
                marginBottom: "1.5rem",
              }}
            >
              {success}
            </div>
          )}

          {!notifications.length ? (
            <div
              style={{
                padding: "2rem",
                borderRadius: "12px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎉</div>
              <h2 style={{ margin: "0 0 0.5rem 0", color: "#1f2937" }}>
                All caught up!
              </h2>
              <p style={{ margin: 0, color: "#475569" }}>
                No pending reminders. Keep an eye on the planner for upcoming work.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {notifications.map((notification) => {
                const session = sessions.find(
                  (s) => s.id === notification.sessionId
                );
                const style = severityStyles[notification.severity];
                return (
                  <div
                    key={notification.id}
                    style={{
                      border: `1px solid ${style.border}`,
                      background: style.bg,
                      color: style.text,
                      borderRadius: "12px",
                      padding: "1rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin: "0 0 0.35rem 0",
                            fontSize: "1rem",
                            color: style.text,
                          }}
                        >
                          {notification.title}
                        </h3>
                        <p
                          style={{
                            margin: 0,
                            color: style.text,
                            fontSize: "0.9rem",
                          }}
                        >
                          {notification.message}
                        </p>
                        {session && (
                          <p
                            style={{
                              margin: "0.4rem 0 0 0",
                              fontSize: "0.82rem",
                            }}
                          >
                            Session: {session.subtaskTitle} • {session.startTime} on{" "}
                            {formatDate(notification.dueDate)}
                          </p>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {notification.severity === "urgent"
                          ? "Urgent"
                          : notification.severity === "warning"
                          ? "Soon"
                          : "Heads-up"}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.75rem",
                        marginTop: "0.75rem",
                      }}
                    >
                      {session && session.status !== "complete" && (
                        <button
                          onClick={() => markSessionComplete(notification)}
                          style={buttonStyle(style.text)}
                        >
                          ✅ Mark done
                        </button>
                      )}
                      <button
                        onClick={() => handleDismiss(notification)}
                        style={buttonStyle(style.text)}
                      >
                        ✋ Dismiss
                      </button>
                      <button
                        onClick={() =>
                          handleSnooze(
                            notification,
                            notification.severity === "urgent" ? 2 : 6
                          )
                        }
                        style={buttonStyle(style.text)}
                      >
                        😴 Snooze {notification.severity === "urgent" ? "2h" : "6h"}
                      </button>
                      <Link
                        to="/progress"
                        style={{
                          ...buttonStyle(style.text),
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                        }}
                      >
                        📅 Open progress
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const buttonStyle = (color: string) => ({
  padding: "0.45rem 1rem",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.4)",
  background: "rgba(255,255,255,0.35)",
  color,
  fontWeight: 600,
  cursor: "pointer",
});

function formatDate(date: string) {
  return parseDate(date).toLocaleDateString("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
