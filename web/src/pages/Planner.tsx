import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import type {
  Assessment,
  Milestone,
  PlannerPreferences,
  PlanResult,
  BusyBlock,
  DaySummary,
} from "../types";
import {
  DEFAULT_PREFERENCES,
  planMilestones,
  withDefaults,
} from "../lib/planner";
import { cascadeDeleteMilestone } from "../lib/dataCleanup";

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

// --- week/date helpers for a fixed Mon→Sun 7-column calendar ---
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

/** ISO local date yyyy-mm-dd (stable regardless of timezone) */
function toIsoDate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/** Monday as the start of week for the given date */
function startOfWeekMonday(d: Date = new Date()): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // if Sun, go back 6; else back to Mon
  return addDays(x, diff);
}

/** e.g., "Mon 10 Nov – Sun 16 Nov" */
function formatRangeCaption(dates: Date[]): string {
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
  const navigate = useNavigate();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const focusSessionId = searchParams.get("focus");
  const emptyState = useMemo(
    () => milestones.length === 0 && (!plan || plan.sessions.length === 0),
    [milestones.length, plan]
  );

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
    const busyCol = collection(db, "users", uid, "busy");

    // live listeners for assessments & milestones
    const unsubAssess = onSnapshot(assessmentsCol, (snap) => {
      setAssessments(snap.docs.map((d) => d.data() as Assessment));
    });
    const unsubMiles = onSnapshot(milestonesCol, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Milestone),
      }));
      setMilestones(list);
    });
    const unsubBusy = onSnapshot(busyCol, (snap) => {
      setBusyBlocks(snap.docs.map((d) => d.data() as BusyBlock));
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
        const prefs = prefsSnap.exists()
          ? withDefaults(prefsSnap.data() as PlannerPreferences)
          : DEFAULT_PREFERENCES;
        setPreferences(prefs);
        setActiveVersion(first?.version ?? null);

        const existingSessions: PlannedSession[] = planSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as PlannedSession;
            return {
              ...data,
              id: docSnap.id,
              status: (data.status as SessionStatus) ?? "planned",
            };
          })
          .sort((a, b) => {
            const dateDiff = a.date.localeCompare(b.date);
            if (dateDiff !== 0) return dateDiff;
            return a.startTime.localeCompare(b.startTime);
          });

        if (existingSessions.length) {
          const byDate = new Map<string, PlannedSession[]>();
          existingSessions.forEach((session) => {
            if (!byDate.has(session.date)) {
              byDate.set(session.date, []);
            }
            byDate.get(session.date)!.push(session);
          });

          const days: DaySummary[] = Array.from(byDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, sessions]) => {
              const total = sessions.reduce(
                (sum, s) => sum + s.durationHours,
                0
              );
              const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
              return {
                date,
                isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
                capacity: prefs.dailyCapHours,
                totalHours: Number(total.toFixed(2)),
                sessions: sessions
                  .slice()
                  .sort((a, b) => a.startTime.localeCompare(b.startTime)),
              };
            });

          setPlan({
            sessions: existingSessions,
            days,
            warnings: [],
            unplaced: [],
            version: first?.version ?? Date.now(),
          });
        } else {
          setPlan(null);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load planner data.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      unsubAssess();
      unsubMiles();
      unsubBusy();
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

  useEffect(() => {
    if (!focusSessionId) return;
    if (!plan || !plan.sessions.length) return;
    const target = plan.sessions.find((s) => s.id === focusSessionId);
    if (!target) return;
    const targetDate = new Date(`${target.date}T00:00:00`);
    const baseMonday = startOfWeekMonday(new Date());
    const diffDays = Math.floor(
      (startOfDay(targetDate).getTime() - startOfDay(baseMonday).getTime()) /
        86_400_000
    );
    if (diffDays >= 0) {
      const newIndex = Math.floor(diffDays / 7) * 7;
      if (newIndex !== weekStartIndex) {
        setWeekStartIndex(newIndex);
      }
    }
    setHighlightedSessionId(focusSessionId);
    const params = new URLSearchParams(searchParams);
    params.delete("focus");
    setSearchParams(params, { replace: true });
  }, [focusSessionId, plan, weekStartIndex, searchParams, setSearchParams]);

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

  const handleDeleteMilestone = useCallback(
    async (milestone: Milestone) => {
      if (!uid || !milestone.id) return;
      const confirm = window.confirm(
        `Delete milestone "${milestone.title}" from ${milestone.assessmentTitle}?`
      );
      if (!confirm) return;
      setBusy(true);
      setError(null);
      let removedSessions = 0;
      try {
        await deleteDoc(doc(db, "users", uid, "milestones", milestone.id));
        await cascadeDeleteMilestone(uid, milestone);
        setPlan((prev) => {
          if (!prev) return prev;
          const isTarget = (session: PlannedSession) =>
            session.assessmentTitle === milestone.assessmentTitle &&
            session.milestoneTitle === milestone.title;

          const filteredSessions = prev.sessions.filter((session) => {
            const match = isTarget(session);
            if (match) removedSessions += 1;
            return !match;
          });

          const filteredDays = prev.days.map((day) => {
            const daySessions = day.sessions.filter((session) => !isTarget(session));
            const totalHours = daySessions.reduce(
              (total, session) => total + session.durationHours,
              0
            );
            return {
              ...day,
              sessions: daySessions,
              totalHours: Number(totalHours.toFixed(2)),
            };
          });

          const filteredUnplaced = prev.unplaced.filter((session) => !isTarget(session));

          if (!filteredSessions.length) {
            return null;
          }

          return {
            ...prev,
            sessions: filteredSessions,
            days: filteredDays,
            unplaced: filteredUnplaced,
          };
        });
        if (removedSessions) {
          setActivePlanCount((prevCount) =>
            Math.max(0, prevCount - removedSessions)
          );
        }
        setSuccessMessage(`Removed milestone "${milestone.title}".`);
      } catch (err: any) {
        console.error("[Planner] delete milestone failed:", err);
        setError(err.message || "Failed to delete milestone.");
      } finally {
        setBusy(false);
      }
    },
    [uid]
  );

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
        busyBlocks,
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

  // --- Build a fixed 7-day (Mon→Sun) week view, paged in 7-day steps ---
  const baseMonday = startOfWeekMonday(new Date()); // current week’s Monday
  const weekStart = addDays(baseMonday, weekStartIndex); // move by ±7 via Prev/Next
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekIso = weekDates.map(toIsoDate);
  const rangeTitle = formatRangeCaption(weekDates);

  // Map the 7 dates to DaySummary: if plan has a day, use it; else create an empty shell
  const findByDate = (iso: string) => plan?.days.find((d) => d.date === iso);
  const weekDays: PlanResult["days"] = weekIso.map((iso, i) => {
    const found = findByDate(iso);
    if (found) return found;
    return {
      date: iso,
      isWeekend: i >= 5, // Sat=5, Sun=6
      capacity: 0,
      totalHours: 0,
      sessions: [],
    };
  });

  // Paging guards
  const canPrev = weekStartIndex > 0;
  const canNext = true; // allow paging forward; tighten if you want

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
          gridTemplateColumns: "minmax(230px, 25%) minmax(0, 1fr)",
          gap: "0.9rem",
        }}
      >
        {/* LEFT: Preferences & actions */}
        <aside
          style={{
            background: "white",
            borderRadius: 16,
            boxShadow: "0 18px 40px rgba(14,165,233,0.15)",
            padding: "0.85rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>
            Preferences
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "0.6rem",
              marginTop: "0.75rem",
            }}
          >
            <NumericField
              label="Daily max focus (h)"
              value={preferences.dailyCapHours}
              onChange={(val) => updatePref("dailyCapHours", val)}
              min={1}
              max={12}
            />
            <NumericField
              label="Day start (hour)"
              value={preferences.startHour}
              onChange={(val) => updatePref("startHour", val)}
              min={5}
              max={12}
            />
            <NumericField
              label="Day end (hour)"
              value={preferences.endHour}
              onChange={(val) => updatePref("endHour", val)}
              min={13}
              max={23}
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

          <button
            onClick={() => navigate("/progress?catchup=1")}
            style={{
              marginTop: "0.65rem",
              width: "100%",
              padding: "0.65rem 1rem",
              background: "#f1f5f9",
              color: "#0369a1",
              border: "1px solid #bae6fd",
              borderRadius: 10,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Catch-up Reschedule
          </button>
          <p
            style={{
              marginTop: "0.4rem",
              color: "#64748b",
              fontSize: "0.8rem",
            }}
          >
            Opens the Progress tracker preview to reallocate overdue sessions with minimal changes.
          </p>

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
                    const sorted = [...entries].sort((a, b) => {
                      const aTime = a.targetDate
                        ? new Date(a.targetDate).getTime()
                        : Number.POSITIVE_INFINITY;
                      const bTime = b.targetDate
                        ? new Date(b.targetDate).getTime()
                        : Number.POSITIVE_INFINITY;
                      return aTime - bTime;
                    });
                    return (
                      <div key={title} style={{ marginBottom: "0.6rem" }}>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>
                          {title}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
                          {entries.length} milestones • {total.toFixed(1)}h
                        </div>
                        <div style={{ marginTop: "0.35rem", display: "grid", gap: "0.35rem" }}>
                          {sorted.map((m) => {
                            const targetLabel = m.targetDate
                              ? shortDate(m.targetDate)
                              : "No target set";
                            const estimateLabel =
                              m.estimateHrs != null
                                ? `${m.estimateHrs.toFixed(1)}h`
                                : "n/a";
                            return (
                              <div
                                key={m.id || `${m.title}-${m.targetDate}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: "0.5rem",
                                  padding: "0.45rem 0.55rem",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: 8,
                                  background: "#f8fafc",
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontSize: "0.9rem",
                                      fontWeight: 600,
                                      color: "#0f172a",
                                    }}
                                  >
                                    {m.title}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "0.8rem",
                                      color: "#475569",
                                    }}
                                  >
                                    Target {targetLabel} • Est. {estimateLabel}
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDeleteMilestone(m)}
                                  disabled={busy || !m.id}
                                  style={{
                                    padding: "0.35rem 0.55rem",
                                    fontSize: "0.75rem",
                                    borderRadius: 6,
                                    border: "1px solid #f87171",
                                    background: busy || !m.id ? "#fee2e2" : "#fef2f2",
                                    color: "#b91c1c",
                                    cursor:
                                      busy || !m.id ? "not-allowed" : "pointer",
                                    fontWeight: 600,
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            );
                          })}
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
            padding: "0.9rem",
            minHeight: 600,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {emptyState && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(255,255,255,0.92)",
                zIndex: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "2rem",
              }}
            >
              <EmptyPlannerGuide onStart={() => navigate("/ingest")} />
            </div>
          )}
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
              <div style={{ color: "#334155", fontWeight: 600, marginTop: 6 }}>
                {rangeTitle}
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
                {weekDays.map(
                  (day: PlanResult["days"][number], idx: number) => (
                    <DayColumn
                      key={day.date}
                      day={day}
                      onToggleDone={toggleDone}
                      highlightedSessionId={highlightedSessionId}
                    />
                  )
                )}
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

function EmptyPlannerGuide({ onStart }: { onStart: () => void }) {
  return (
    <div
      style={{
        maxWidth: 480,
        textAlign: "center",
        background: "white",
        borderRadius: 16,
        padding: "2rem",
        boxShadow: "0 12px 32px rgba(14,165,233,0.25)",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🚀</div>
      <h3 style={{ margin: 0, color: "#0f172a" }}>Let’s get you started</h3>
      <p style={{ color: "#475569", fontSize: "0.95rem", marginTop: "0.5rem" }}>
        No milestones or sessions detected yet. Import your timetable or CSV so we can build your study plan automatically.
      </p>
      <button
        onClick={onStart}
        style={{
          marginTop: "1rem",
          padding: "0.75rem 1.5rem",
          borderRadius: 12,
          border: "none",
          background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
          color: "white",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 10px 24px rgba(99,102,241,0.35)",
        }}
      >
        Go to Ingest
      </button>
    </div>
  );
}

function DayColumn({
  day,
  onToggleDone,
  highlightedSessionId,
}: {
  day: PlanResult["days"][number];
  onToggleDone: (id: string, next: boolean) => void;
  highlightedSessionId?: string | null;
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
        minWidth: 0,
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
            <SessionCard
              key={s.id}
              session={s}
              onToggleDone={onToggleDone}
              highlighted={highlightedSessionId === s.id}
            />
          ))
      )}
    </div>
  );
}

function SessionCard({
  session,
  onToggleDone,
  highlighted,
}: {
  session: PlannedSession;
  onToggleDone: (id: string, next: boolean) => void;
  highlighted?: boolean;
}) {
  const color = riskColors(session.riskLevel);
  const borderColor = highlighted ? "#38bdf8" : color.border;
  const background = highlighted ? "#e0f2fe" : color.bg;
  return (
    <div
      style={{
        borderRadius: 12,
        border: `2px solid ${borderColor}`,
        background,
        padding: "0.55rem",
        boxShadow: highlighted
          ? "0 0 0 4px rgba(56,189,248,0.2), 0 6px 18px rgba(15,23,42,0.18)"
          : "0 2px 6px rgba(15,23,42,0.05)",
        transition: "box-shadow 0.2s ease",
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
        style={{ fontSize: "0.82rem", color: "#475569", marginTop: "0.25rem" }}
      >
        {session.assessmentTitle} • {session.milestoneTitle}
      </div>
      {session.notes && (
        <div
          style={{
            fontSize: "0.78rem",
            color: "#1e293b",
            marginTop: "0.35rem",
            background: "rgba(148,163,184,0.18)",
            padding: "0.4rem 0.5rem",
            borderRadius: 8,
          }}
        >
          {session.notes}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "0.5rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: color.text,
            background: color.bg,
            padding: "0.2rem 0.55rem",
            borderRadius: "999px",
            border: `1px solid ${color.border}`,
            textTransform: "capitalize",
          }}
        >
          {session.riskLevel.replace("-", " ")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", color: "#475569" }}>
            {session.durationHours.toFixed(1)}h
          </span>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.8rem",
              color: "#0f172a",
              cursor: "pointer",
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
