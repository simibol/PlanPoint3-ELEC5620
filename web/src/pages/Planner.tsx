import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  updateDoc,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import type {
  Assessment,
  Milestone,
  PlannerPreferences,
  PlanResult,
  PlanSession,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  planMilestones,
  withDefaults,
} from "../lib/planner";

import type { PlannedSession, SessionStatus, RiskLevel } from "../types";

// UI risk union (restrict to the UI-safe set)
type UIRisk = "on-track" | "warning" | "late";

// Normalize any engine risk label to valid UI tag
function normalizeRiskLevel(r: any): UIRisk {
  const s = String(r || "").toLowerCase();
  if (s === "on-track" || s === "warning" || s === "late") return s as UIRisk;
  if (s === "at-risk") return "warning";
  return "on-track";
}

// Ensure a stable id for sessions if the planner didn't provide one
function ensureId(s: any): string {
  return (
    s.id ||
    [
      s.assessmentTitle,
      s.milestoneTitle,
      s.date || s.targetDate || "",
      s.startTime || "",
      s.endTime || "",
    ]
      .filter(Boolean)
      .join("|")
  );
}

// Convert raw PlanSession/engine output → PlannedSession (no 'done' property)
function toPlannedSession(s: any, version: number): PlannedSession {
  const now = new Date().toISOString();
  return {
    ...s,
    id: ensureId(s),
    riskLevel: normalizeRiskLevel(s.riskLevel) as RiskLevel, // cast to domain type
    status: (s.status as SessionStatus) ?? ("planned" as SessionStatus),
    version: s.version ?? version ?? 1,
    createdAt: s.createdAt ?? now,
    updatedAt: now,
  };
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toIsoDate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// Monday as start of week
function startOfWeekMonday(d = new Date()): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // if Sun, go back 6; else 1-day
  return addDays(x, diff);
}

function formatRangeCaption(dates: Date[]) {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  const first = dates[0].toLocaleDateString("en-AU", opts);
  const last = dates[6].toLocaleDateString("en-AU", opts);
  return `${first} – ${last}`;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Map "is this done?" and "set done" in a typed-safe way
const isDone = (status?: SessionStatus) =>
  status === ("completed" as SessionStatus) || status === ("done" as any); // allow legacy "done" if it sneaks in

const DONE_STATUS = "completed" as SessionStatus;
const TODO_STATUS = "planned" as SessionStatus; // or "todo" if your union has it

// --- date formatting helpers (AU) ---
const longDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Australia/Sydney",
  });

const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Australia/Sydney",
  });

// --- compute a simple 7-day window from a start index into plan.days ---
function sliceWeek(days: PlanResult["days"], startIndex: number) {
  return days.slice(startIndex, startIndex + 7);
}

// --- risk pill UI color ---
function riskColors(risk: PlannedSession["riskLevel"]) {
  switch (risk) {
    case "on-track":
      return { bg: "#f1f5f9", text: "#0f172a", border: "#e2e8f0" };
    case "warning":
      return { bg: "#fef3c7", text: "#92400e", border: "#fde68a" };
    case "late":
      return { bg: "#fee2e2", text: "#b91c1c", border: "#fecaca" };
    default:
      return { bg: "#f1f5f9", text: "#0f172a", border: "#e2e8f0" };
  }
}

export default function Planner() {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [preferences, setPreferences] =
    useState<PlannerPreferences>(DEFAULT_PREFERENCES);
  const [prefDirty, setPrefDirty] = useState(false);

  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [activePlanCount, setActivePlanCount] = useState(0);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // week paging for calendar preview
  const [weekStartIndex, setWeekStartIndex] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);

    const assessmentsCol = collection(db, "users", uid, "assessments");
    const milestonesCol = collection(db, "users", uid, "milestones");
    const planCol = collection(db, "users", uid, "planSessions");
    const settingsDoc = doc(db, "users", uid, "settings", "planner");

    // live listeners for assessments & milestones
    const unsubAssess = onSnapshot(assessmentsCol, (snap) => {
      setAssessments(snap.docs.map((d) => d.data() as Assessment));
    });
    const unsubMiles = onSnapshot(milestonesCol, (snap) => {
      setMilestones(snap.docs.map((d) => d.data() as Milestone));
    });

    // one-shot reads for plan + prefs
    (async () => {
      try {
        const [planSnap, prefsSnap] = await Promise.all([
          getDocs(planCol),
          getDoc(settingsDoc),
        ]);
        setActivePlanCount(planSnap.size);
        const first = planSnap.docs[0]?.data() as
          | { version?: number }
          | undefined;
        setActiveVersion(first?.version ?? null);

        setPreferences(
          prefsSnap.exists()
            ? withDefaults(prefsSnap.data() as PlannerPreferences)
            : DEFAULT_PREFERENCES
        );
      } catch (e: any) {
        setError(e.message || "Failed to load planner data.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      unsubAssess();
      unsubMiles();
    };
  }, [uid]);

  // Derived milestone grouping (for the "Milestones overview" panel)
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
    setWeekStartIndex(0);
  }, [plan]);

  const updatePref = <K extends keyof PlannerPreferences>(
    key: K,
    value: PlannerPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setPrefDirty(true);
  };

  const handleSavePreferences = async () => {
    if (!uid) return;
    try {
      await setDoc(doc(db, "users", uid, "settings", "planner"), preferences, {
        merge: true,
      });
      setPrefDirty(false);
      setSuccessMessage("Preferences saved.");
    } catch (err: any) {
      console.error("[Planner] save preferences failed:", err);
      setError(err.message || "Unable to save preferences.");
    }
  };

  const handleGenerate = async () => {
    if (!milestones.length) {
      alert("Add milestones first via UC2.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = planMilestones(milestones, assessments, preferences, {
        startDate: new Date(),
      });
      const version = raw.version ?? 1;

      const fixed: PlanResult = {
        ...raw,
        sessions: raw.sessions.map((s) => toPlannedSession(s, version)),
        days: raw.days.map((d) => ({
          ...d,
          sessions: d.sessions.map((s) => toPlannedSession(s, version)),
        })),
      };

      setPlan(fixed);
      setSuccessMessage(
        "Auto-plan generated. Review on the calendar and Apply when ready."
      );
    } catch (err: any) {
      console.error("[Planner] generate failed:", err);
      setError(err.message || "Failed to generate a plan.");
    } finally {
      setBusy(false);
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
      await handleSavePreferences(); // ensures prefs are saved too
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

  // Toggle a session's completion (persist to Firestore if applied)
  const toggleDone = useCallback(
    async (sessionId: string, next: boolean) => {
      if (!uid) return;

      // Update local preview
      setPlan((prev) => {
        if (!prev) return prev;
        const updatedSessions = prev.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, status: next ? DONE_STATUS : TODO_STATUS }
            : s
        );
        const days = prev.days.map((d) => ({
          ...d,
          sessions: d.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, status: next ? DONE_STATUS : TODO_STATUS }
              : s
          ),
        }));
        return { ...prev, sessions: updatedSessions, days };
      });

      // Persist if applied
      try {
        const ref = doc(db, "users", uid, "planSessions", sessionId);
        await updateDoc(ref, {
          status: next ? DONE_STATUS : TODO_STATUS,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // ignore if not applied yet
      }
    },
    [uid]
  );

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

  // Calendar slice for current week pane
  const weekDays = plan ? sliceWeek(plan.days, weekStartIndex) : [];
  const canPrev = plan ? weekStartIndex > 0 : false;
  const canNext = plan ? weekStartIndex + 7 < plan.days.length : false;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
        padding: "1.25rem",
      }}
    >
      {/* Header + metrics */}
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto 1rem auto",
          color: "white",
          padding: "1rem 0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(255,255,255,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
            🗓️
          </div>
          <div>
            <h1 style={{ margin: 0, letterSpacing: "-0.02em" }}>
              Auto Planner
            </h1>
            <div style={{ opacity: 0.9 }}>
              Preferences on the left • Calendar on the right
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginTop: "0.75rem",
            flexWrap: "wrap",
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
              activeVersion ? `Version ${activeVersion}` : "No plan applied"
            }
          />
          <MetricTile
            label="Preview hours (week 1)"
            value={
              plan
                ? plan.days
                    .slice(0, 7)
                    .reduce((acc, d) => acc + d.totalHours, 0)
                    .toFixed(1) + "h"
                : "0h"
            }
            helper="First 7 days in preview"
          />
        </div>
      </div>

      {/* Two-pane layout */}
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: "1rem",
        }}
      >
        {/* LEFT: Preferences & actions */}
        <aside
          style={{
            background: "white",
            borderRadius: 16,
            boxShadow: "0 18px 40px rgba(14,165,233,0.15)",
            padding: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>
            Preferences
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            <NumericField
              label="Daily focus cap (h)"
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
              label="Breaks (min)"
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
          </div>

          <div style={{ marginTop: "0.5rem" }}>
            <ToggleField
              label="Allow weekend sessions"
              checked={preferences.allowWeekends}
              onChange={(val) => updatePref("allowWeekends", val)}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              onClick={handleSavePreferences}
              disabled={!prefDirty || busy}
              style={{
                padding: "0.6rem 0.9rem",
                background: prefDirty ? "#0ea5e9" : "#bfdbfe",
                color: prefDirty ? "white" : "#1d4ed8",
                border: "none",
                borderRadius: 10,
                cursor: prefDirty && !busy ? "pointer" : "not-allowed",
                fontWeight: 600,
                flex: 1,
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={busy || !milestones.length}
              style={{
                padding: "0.6rem 0.9rem",
                background:
                  busy || !milestones.length
                    ? "#e5e7eb"
                    : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                color: busy || !milestones.length ? "#6b7280" : "white",
                border: "none",
                borderRadius: 10,
                cursor: busy || !milestones.length ? "not-allowed" : "pointer",
                fontWeight: 600,
                flex: 1,
              }}
            >
              {busy ? "Planning…" : "Generate"}
            </button>
          </div>

          <button
            onClick={handleApply}
            disabled={busy || !plan}
            style={{
              marginTop: "0.5rem",
              width: "100%",
              padding: "0.7rem 1rem",
              background:
                busy || !plan
                  ? "#e2e8f0"
                  : "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
              color: busy || !plan ? "#64748b" : "white",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              cursor: busy || !plan ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Applying…" : "Apply to Calendar"}
          </button>

          {error && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.7rem",
                borderRadius: 10,
                background: "#fee2e2",
                color: "#b91c1c",
              }}
            >
              {error}
            </div>
          )}
          {successMessage && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.7rem",
                borderRadius: 10,
                background: "#ecfdf5",
                color: "#047857",
              }}
            >
              {successMessage}
            </div>
          )}

          {/* Milestones overview (collapsed list) */}
          <div style={{ marginTop: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#0f172a" }}>
              Milestones overview
            </h3>
            {!milestones.length ? (
              <p style={{ color: "#475569", fontSize: "0.9rem" }}>
                No milestones detected.
              </p>
            ) : (
              <div
                style={{
                  marginTop: "0.4rem",
                  maxHeight: 250,
                  overflow: "auto",
                }}
              >
                {Array.from(milestonesByAssessment.entries()).map(
                  ([title, entries]) => {
                    const total = entries.reduce(
                      (acc, m) => acc + (m.estimateHrs ?? 0),
                      0
                    );
                    return (
                      <div key={title} style={{ marginBottom: "0.6rem" }}>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>
                          {title}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
                          {entries.length} milestones • {total.toFixed(1)}h
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT: Calendar */}
        <section
          style={{
            background: "white",
            borderRadius: 16,
            boxShadow: "0 18px 40px rgba(14,165,233,0.15)",
            padding: "1rem",
            minHeight: 600,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>
                Calendar
              </h2>
              <div style={{ color: "#64748b", fontSize: "0.9rem" }}>
                {plan
                  ? `Version ${plan.version} • ${plan.sessions.length} sessions`
                  : "No preview yet"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => setWeekStartIndex((i) => Math.max(0, i - 7))}
                disabled={!canPrev}
                style={navBtnStyle(!canPrev)}
              >
                ◀ Prev
              </button>
              <button
                onClick={() => setWeekStartIndex((i) => (canNext ? i + 7 : i))}
                disabled={!canNext}
                style={navBtnStyle(!canNext)}
              >
                Next ▶
              </button>
            </div>
          </div>

          {/* Week grid */}
          {!plan ? (
            <EmptyCalendarHint />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "0.75rem",
                  marginTop: "0.75rem",
                }}
              >
                {weekDays.map((day) => (
                  <DayColumn
                    key={day.date}
                    day={day}
                    onToggleDone={toggleDone}
                  />
                ))}
              </div>

              {/* Unplaced */}
              {!!plan.unplaced.length && (
                <div
                  style={{
                    marginTop: "1rem",
                    border: "1px dashed #fca5a5",
                    borderRadius: 12,
                    padding: "0.75rem",
                    background: "#fff1f2",
                    color: "#b91c1c",
                  }}
                >
                  <strong>Unplaced tasks:</strong>
                  <ul style={{ marginTop: "0.5rem" }}>
                    {plan.unplaced.map((s) => (
                      <li key={s.id}>
                        {s.subtaskTitle} (needs {s.durationHours.toFixed(1)}h
                        before {shortDate(s.assessmentDueDate)})
                      </li>
                    ))}
                  </ul>
                  <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    Increase daily capacity, expand working window, or allow
                    weekends to place these automatically.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 0.8rem",
    background: disabled ? "#e5e7eb" : "#0ea5e9",
    color: disabled ? "#6b7280" : "white",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function EmptyCalendarHint() {
  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "2rem",
        textAlign: "center",
        border: "2px dashed #cbd5e1",
        borderRadius: 12,
        color: "#475569",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🧭</div>
      <div>
        Press <strong>Generate</strong> to populate your calendar with sessions.
      </div>
    </div>
  );
}

function DayColumn({
  day,
  onToggleDone,
}: {
  day: PlanResult["days"][number];
  onToggleDone: (id: string, next: boolean) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "0.75rem",
        background: "#ffffff",
        minHeight: 420,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: "#0f172a" }}>
            {longDate(day.date)}
          </div>
          <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
            {day.totalHours.toFixed(1)}h / {day.capacity.toFixed(1)}h
          </div>
        </div>
        {day.isWeekend && (
          <span
            style={{ fontSize: "0.75rem", color: "#f97316", fontWeight: 700 }}
          >
            Weekend
          </span>
        )}
      </header>

      {day.sessions.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
          No sessions.
        </div>
      ) : (
        day.sessions
          .slice()
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((s) => (
            <SessionCard key={s.id} session={s} onToggleDone={onToggleDone} />
          ))
      )}
    </div>
  );
}

function SessionCard({
  session,
  onToggleDone,
}: {
  session: PlannedSession;
  onToggleDone: (id: string, next: boolean) => void;
}) {
  const color = riskColors(session.riskLevel);
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${color.border}`,
        background: color.bg,
        padding: "0.6rem",
        boxShadow: "0 2px 6px rgba(15,23,42,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div style={{ fontWeight: 700, color: color.text, flex: 1 }}>
          {session.subtaskTitle}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#334155" }}>
          {session.startTime}–{session.endTime}
        </div>
      </div>
      <div
        style={{ fontSize: "0.85rem", color: "#475569", marginTop: "0.2rem" }}
      >
        {session.assessmentTitle} • {session.milestoneTitle}
      </div>
      {session.notes && (
        <div
          style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.2rem" }}
        >
          {session.notes}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "0.4rem",
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "#475569" }}>
          {session.durationHours.toFixed(1)}h
        </span>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.85rem",
          }}
        >
          <input
            type="checkbox"
            checked={isDone(session.status)}
            onChange={(e) => onToggleDone(session.id, e.target.checked)}
          />
          Done
        </label>
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
        padding: "0.8rem 1rem",
        borderRadius: 12,
        background: "rgba(255,255,255,0.16)",
        minWidth: 160,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontSize: "0.82rem", opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{value}</div>
      {helper && (
        <div style={{ fontSize: "0.78rem", opacity: 0.85 }}>{helper}</div>
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
        gap: "0.25rem",
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
          padding: "0.55rem 0.65rem",
          borderRadius: 8,
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
        gap: "0.6rem",
        fontSize: "0.92rem",
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
