import {
  Assessment,
  Milestone,
  PlannerPreferences,
  PlanResult,
  PlannedSession,
  PlanWarning,
  DaySummary,
  NotificationItem,
  NotificationState,
  WeeklyProgress,
  BusyBlock,
} from "../types";

const MS_PER_DAY = 86_400_000;
const EPSILON = 1e-4;

type Slot = {
  start: number;
  end: number;
};

export const DEFAULT_PREFERENCES: PlannerPreferences = {
  dailyCapHours: 4,
  minSessionMinutes: 45,
  maxSessionMinutes: 105,
  focusBlockMinutes: 15,
  allowWeekends: false,
  startHour: 9,
  endHour: 18,
};

type SubtaskInput = {
  id: string;
  assessmentTitle: string;
  assessmentDueDate: string;
  milestoneTitle: string;
  subtaskTitle: string;
  durationHours: number;
  notes?: string;
  order: number;
  dueDate: string;
  weightScore: number;
};

type MutableDay = DaySummary & {
  workedHours: number;
  assessmentLoad: Record<string, number>;
  availableSlots: Slot[];
};

const isSessionCompleted = (status: string | undefined) =>
  status === "completed" || status === "complete";

export function withDefaults(
  prefs?: Partial<PlannerPreferences>
): PlannerPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...(prefs || {}),
  };
}

const makeId = (seed: string) => {
  const globalCrypto = (globalThis as any)?.crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `${seed}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
};

const startOfDay = (d: Date) => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

const startOfWeek = (d: Date) => {
  const date = startOfDay(d);
  const day = date.getDay();
  const diff = (day + 6) % 7; // Monday as start
  date.setDate(date.getDate() - diff);
  return date;
};

const addDays = (d: Date, days: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
};

const isWeekend = (d: Date) => {
  const day = d.getDay();
  return day === 0 || day === 6;
};

const formatDateKey = (d: Date) => {
  return d.toISOString().slice(0, 10);
};

const parseDateKey = (key: string) => {
  return startOfDay(new Date(`${key}T00:00:00`));
};

const toTimeString = (decimalHour: number) => {
  const hour = Math.floor(decimalHour);
  const minutes = Math.round((decimalHour - hour) * 60);
  return `${hour.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
};

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val));

const sumSlotHours = (slots: Slot[]) =>
  slots.reduce((total, slot) => total + Math.max(0, slot.end - slot.start), 0);

const splitBusyBlocks = (
  busyBlocks: BusyBlock[],
  rangeStart: Date,
  rangeEnd: Date
): Map<string, Slot[]> => {
  const map = new Map<string, Slot[]>();
  if (!busyBlocks.length) return map;

  const minDay = startOfDay(rangeStart);
  const maxDay = startOfDay(rangeEnd);
  const rangeEndMs = addDays(maxDay, 1).getTime();

  busyBlocks.forEach((block) => {
    const rawStart = new Date(block.start);
    const rawEnd = new Date(block.end);
    const startMs = rawStart.getTime();
    const endMs = rawEnd.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs <= startMs) return;
    if (endMs <= minDay.getTime() || startMs >= rangeEndMs) return;

    let cursor = startOfDay(rawStart);
    if (cursor.getTime() < minDay.getTime()) {
      cursor = new Date(minDay);
    }

    while (cursor.getTime() <= maxDay.getTime()) {
      const dayStartMs = cursor.getTime();
      const dayEndMs = dayStartMs + MS_PER_DAY;
      if (dayStartMs >= endMs) break;

      const overlapStart = Math.max(startMs, dayStartMs);
      const overlapEnd = Math.min(endMs, dayEndMs);
      if (overlapEnd > overlapStart + EPSILON) {
        const dayKey = formatDateKey(cursor);
        const startHour = (overlapStart - dayStartMs) / 3_600_000;
        const endHour = (overlapEnd - dayStartMs) / 3_600_000;
        if (!map.has(dayKey)) map.set(dayKey, []);
        map.get(dayKey)!.push({
          start: Number(startHour.toFixed(4)),
          end: Number(endHour.toFixed(4)),
        });
      }

      if (dayEndMs >= endMs) break;
      cursor = addDays(cursor, 1);
    }
  });

  // Ensure busy blocks per day are sorted
  map.forEach((list, key) => {
    map.set(
      key,
      list
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((slot) => ({
          start: Number(slot.start.toFixed(4)),
          end: Number(slot.end.toFixed(4)),
        }))
    );
  });

  return map;
};

const createDailySlots = (
  prefs: PlannerPreferences,
  busy: Slot[] | undefined,
  isWeekend: boolean
): Slot[] => {
  if (!prefs.allowWeekends && isWeekend) return [];

  const windowStart = prefs.startHour;
  const windowEnd = prefs.endHour;
  if (windowEnd <= windowStart) return [];

  let slots: Slot[] = [{ start: windowStart, end: windowEnd }];

  if (busy?.length) {
    for (const block of busy) {
      const busyStart = clamp(block.start, windowStart, windowEnd);
      const busyEnd = clamp(block.end, windowStart, windowEnd);
      if (busyEnd <= busyStart + EPSILON) continue;

      const next: Slot[] = [];
      for (const slot of slots) {
        if (busyEnd <= slot.start + EPSILON || busyStart >= slot.end - EPSILON) {
          next.push(slot);
          continue;
        }

        if (busyStart > slot.start + EPSILON) {
          next.push({
            start: slot.start,
            end: busyStart,
          });
        }

        if (busyEnd < slot.end - EPSILON) {
          next.push({
            start: busyEnd,
            end: slot.end,
          });
        }
      }
      slots = next;
      if (!slots.length) break;
    }
  }

  return slots
    .map((slot) => ({
      start: Number(slot.start.toFixed(4)),
      end: Number(slot.end.toFixed(4)),
    }))
    .filter((slot) => slot.end - slot.start > 1 / 60);
};

const findPlacementInSlots = (
  slots: Slot[],
  duration: number
): { index: number; start: number } | null => {
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (slot.end - slot.start + EPSILON >= duration) {
      return { index: i, start: slot.start };
    }
  }
  return null;
};

const divideHours = (
  totalHours: number,
  prefs: PlannerPreferences
): number[] => {
  const min = prefs.minSessionMinutes / 60;
  const max = prefs.maxSessionMinutes / 60;
  const parts: number[] = [];
  let remaining = Math.max(totalHours, min);
  while (remaining > 0) {
    const slice = clamp(remaining, min, max);
    parts.push(Number(slice.toFixed(2)));
    remaining = Number((remaining - slice).toFixed(2));
    if (remaining < min / 2) {
      if (parts.length) parts[parts.length - 1] += remaining;
      else parts.push(remaining);
      break;
    }
  }
  return parts;
};

const createSubtasks = (
  milestone: Milestone,
  assessment: Assessment | undefined,
  prefs: PlannerPreferences
): SubtaskInput[] => {
  const total = Math.max(milestone.estimateHrs ?? 2, 1);
  const segments = divideHours(total, prefs);
  const dueDate = milestone.targetDate || assessment?.dueDate || new Date().toISOString();
  const importance =
    (assessment?.weight ?? 10) +
    Math.max(0, 50 - Math.min(50, segments.length * 5));

  return segments.map((hours, index) => {
    const base = milestone.title.toLowerCase();
    let notes = "";
    if (base.includes("research") || base.includes("review")) {
      notes = "Gather sources and capture notes in reference doc.";
    } else if (base.includes("draft")) {
      notes = "Focus on producing a rough draft; ignore polish for now.";
    } else if (base.includes("edit") || base.includes("revise")) {
      notes = "Work through feedback and tighten structure.";
    } else if (base.includes("plan") || base.includes("outline")) {
      notes = "Define sections, deliverables, and success criteria.";
    }

    const subtaskTitle =
      segments.length === 1
        ? milestone.title
        : `${milestone.title} – Session ${index + 1}`;

    return {
      id: `${milestone.assessmentTitle}-${milestone.title}-${index}`,
      assessmentTitle: milestone.assessmentTitle,
      assessmentDueDate: milestone.assessmentDueDate || dueDate,
      milestoneTitle: milestone.title,
      subtaskTitle,
      durationHours: Number(hours.toFixed(2)),
      notes,
      order: index,
      dueDate,
      weightScore: importance,
    };
  });
};

type ScheduleOptions = {
  startDate?: Date;
  version?: number;
  preserveIds?: boolean;
  busyBlocks?: BusyBlock[];
};

const scheduleSubtasks = (
  subtasks: SubtaskInput[],
  preferences: PlannerPreferences,
  options?: ScheduleOptions
): PlanResult => {
  const prefs = withDefaults(preferences);
  const start = startOfDay(options?.startDate || new Date());
  const version = options?.version ?? Date.now();
  const busyBlocks = options?.busyBlocks ?? [];

  if (!subtasks.length) {
    return {
      sessions: [],
      days: [],
      warnings: [],
      unplaced: [],
      version,
    };
  }

  const sortedSubtasks = [...subtasks].sort((a, b) => {
    const dueDiff =
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (dueDiff !== 0) return dueDiff;
    if (b.weightScore !== a.weightScore) return b.weightScore - a.weightScore;
    return a.order - b.order;
  });

  let maxDue = sortedSubtasks.reduce((latest, sub) => {
    const due = new Date(sub.dueDate).getTime();
    return due > latest ? due : latest;
  }, start.getTime());
  if (maxDue < start.getTime()) {
    maxDue = start.getTime();
  }

  const end = addDays(new Date(maxDue), 7);
  const busyIndex = splitBusyBlocks(busyBlocks, start, end);
  const days: MutableDay[] = [];

  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    const dateKey = formatDateKey(cursor);
    const weekend = isWeekend(cursor);
    const busyForDay = busyIndex.get(dateKey);
    const availableSlots = createDailySlots(prefs, busyForDay, weekend);
    const slotHours = sumSlotHours(availableSlots);
    const capacity = Math.min(
      prefs.dailyCapHours,
      slotHours > 0 ? slotHours : 0
    );
    days.push({
      date: dateKey,
      isWeekend: weekend,
      capacity: Number(capacity.toFixed(2)),
      totalHours: 0,
      sessions: [],
      workedHours: 0,
      assessmentLoad: {},
      availableSlots,
    });
  }

  const warnings: PlanWarning[] = [];
  const unplaced: PlannedSession[] = [];
  const sessions: PlannedSession[] = [];
  const lastSessionByMilestone = new Map<string, string>();

  sortedSubtasks.forEach((sub) => {
    if (sub.durationHours <= 0) return;
    const dueTs = new Date(sub.dueDate).getTime();
    let chosen: MutableDay | null = null;
    let chosenScore = Number.POSITIVE_INFINITY;
    let fallback: { day: MutableDay; score: number } | null = null;

    for (const day of days) {
      if (day.capacity <= 0) continue;
      const dayDate = parseDateKey(day.date);
      if (dayDate.getTime() < start.getTime()) continue;

      if (day.workedHours + sub.durationHours > day.capacity + 0.01) continue;
      const placement = findPlacementInSlots(
        day.availableSlots,
        sub.durationHours
      );
      if (!placement) continue;

      const diffDays = (dueTs - dayDate.getTime()) / MS_PER_DAY;
      const load = day.assessmentLoad[sub.assessmentTitle] ?? 0;
      const utilisation =
        day.capacity > 0 ? day.workedHours / day.capacity : Number.MAX_SAFE_INTEGER;
      const score =
        utilisation * 10 +
        load * 4 +
        (diffDays >= 0 ? diffDays : Math.abs(diffDays) * 2) -
        sub.weightScore * 0.01;

      if (dayDate.getTime() <= dueTs) {
        if (!chosen || score < chosenScore) {
          chosen = day;
          chosenScore = score;
        }
      } else if (!fallback || score < fallback.score) {
        fallback = { day, score };
      }
    }

    const targetDay = chosen || fallback?.day || null;
    const riskLevel: "on-track" | "warning" | "at-risk" =
      !targetDay || parseDateKey(targetDay.date).getTime() > dueTs
        ? "at-risk"
        : Math.abs(
            parseDateKey(targetDay.date).getTime() - dueTs
          ) <= MS_PER_DAY
        ? "warning"
        : "on-track";

    if (!targetDay) {
      warnings.push({
        type: "capacity",
        message: `Unable to schedule "${sub.subtaskTitle}" before ${sub.dueDate}.`,
        detail:
          "Increase daily capacity, allow weekends, or reduce session duration.",
      });
      const placeholderId = options?.preserveIds ? sub.id : makeId(sub.id);
      const blockedBy = sub.order > 0 ? lastSessionByMilestone.get(sub.milestoneTitle) : undefined;
      const placeholder: PlannedSession = {
        id: placeholderId,
        assessmentTitle: sub.assessmentTitle,
        assessmentDueDate: sub.assessmentDueDate,
        milestoneTitle: sub.milestoneTitle,
        subtaskTitle: sub.subtaskTitle,
        date: formatDateKey(new Date(sub.dueDate)),
        startTime: "09:00",
        endTime: "10:00",
        durationHours: sub.durationHours,
        status: "planned",
        notes: sub.notes,
        riskLevel: "at-risk",
        version,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(blockedBy ? { blockedBy } : {}),
      };
      unplaced.push(placeholder);
      return;
    }

    const placement = findPlacementInSlots(
      targetDay.availableSlots,
      sub.durationHours
    );

    if (!placement) {
      warnings.push({
        type: "conflict",
        message: `Busy times prevented scheduling "${sub.subtaskTitle}" on ${targetDay.date}.`,
        detail:
          "Adjust busy calendar entries or expand availability to free up space.",
      });
      const placeholderId = options?.preserveIds ? sub.id : makeId(sub.id);
      const blockedBy =
        sub.order > 0 ? lastSessionByMilestone.get(sub.milestoneTitle) : undefined;
      unplaced.push({
        id: placeholderId,
        assessmentTitle: sub.assessmentTitle,
        assessmentDueDate: sub.assessmentDueDate,
        milestoneTitle: sub.milestoneTitle,
        subtaskTitle: sub.subtaskTitle,
        date: formatDateKey(new Date(sub.dueDate)),
        startTime: "09:00",
        endTime: "10:00",
        durationHours: sub.durationHours,
        status: "planned",
        notes: sub.notes,
        riskLevel: "at-risk",
        version,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(blockedBy ? { blockedBy } : {}),
      });
      return;
    }

    const slot = targetDay.availableSlots[placement.index];
    const slotEnd = slot.end;
    const startTimeDecimal = placement.start;
    const endTimeDecimal = startTimeDecimal + sub.durationHours;
    const sessionId = options?.preserveIds ? sub.id : makeId(sub.id);
    const blockedBy =
      sub.order > 0 ? lastSessionByMilestone.get(sub.milestoneTitle) : undefined;
    const session: PlannedSession = {
      id: sessionId,
      assessmentTitle: sub.assessmentTitle,
      assessmentDueDate: sub.assessmentDueDate,
      milestoneTitle: sub.milestoneTitle,
      subtaskTitle: sub.subtaskTitle,
      date: targetDay.date,
      startTime: toTimeString(startTimeDecimal),
      endTime: toTimeString(endTimeDecimal),
      durationHours: sub.durationHours,
      status: "planned",
      notes: sub.notes,
      riskLevel,
      version,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(blockedBy ? { blockedBy } : {}),
    };

    targetDay.sessions.push(session);
    targetDay.workedHours = Number(
      (targetDay.workedHours + sub.durationHours).toFixed(2)
    );
    targetDay.totalHours = targetDay.workedHours;
    targetDay.assessmentLoad[sub.assessmentTitle] =
      (targetDay.assessmentLoad[sub.assessmentTitle] || 0) + 1;

    const shouldAddBreak =
      targetDay.workedHours < targetDay.capacity - 0.01 &&
      prefs.focusBlockMinutes > 0;
    const breakHours = shouldAddBreak ? prefs.focusBlockMinutes / 60 : 0;
    const nextStart = endTimeDecimal + breakHours;
    if (nextStart >= slotEnd - EPSILON) {
      targetDay.availableSlots.splice(placement.index, 1);
    } else {
      targetDay.availableSlots[placement.index] = {
        start: Number(nextStart.toFixed(4)),
        end: slotEnd,
      };
    }

    if (riskLevel !== "on-track") {
      warnings.push({
        type: riskLevel === "warning" ? "deadline" : "capacity",
        message: `"${sub.subtaskTitle}" is scheduled ${
          riskLevel === "warning" ? "on its due date" : "after its due date"
        }.`,
        detail:
          riskLevel === "warning"
            ? "Consider starting earlier to leave review time."
            : "Increase daily capacity or extend availability to avoid lateness.",
      });
    }

    sessions.push(session);
    lastSessionByMilestone.set(sub.milestoneTitle, sessionId);
  });

  const daySummaries: DaySummary[] = days.map((day) => ({
    date: day.date,
    isWeekend: day.isWeekend,
    capacity: day.capacity,
    totalHours: Number(day.totalHours.toFixed(2)),
    sessions: day.sessions,
  }));

  return {
    sessions,
    days: daySummaries,
    warnings,
    unplaced,
    version,
  };
};

export const planMilestones = (
  milestones: Milestone[],
  assessments: Assessment[],
  preferences?: Partial<PlannerPreferences>,
  options?: { startDate?: Date; busyBlocks?: BusyBlock[] }
): PlanResult => {
  const prefs = withDefaults(preferences);
  const assessmentByTitle = new Map(
    assessments.map((a) => [a.title, a] as const)
  );

  const subtasks = milestones.flatMap((milestone) => {
    const assessment = assessmentByTitle.get(milestone.assessmentTitle);
    return createSubtasks(milestone, assessment, prefs);
  });

  return scheduleSubtasks(subtasks, prefs, {
    ...options,
    preserveIds: true,
  });
};

export const rescheduleSessions = (
  sessions: PlannedSession[],
  preferences?: Partial<PlannerPreferences>,
  options?: { startDate?: Date; busyBlocks?: BusyBlock[] }
): PlanResult => {
  const prefs = withDefaults(preferences);
  const subtasks: SubtaskInput[] = sessions
    .filter((s) => !isSessionCompleted(s.status))
    .map((session, index) => ({
      id: session.id,
      assessmentTitle: session.assessmentTitle,
      assessmentDueDate: session.assessmentDueDate,
      milestoneTitle: session.milestoneTitle,
      subtaskTitle: session.subtaskTitle,
      durationHours: session.durationHours,
      notes: session.notes,
      order: index,
      dueDate: session.assessmentDueDate,
      weightScore: 20,
    }));

  return scheduleSubtasks(subtasks, prefs, options);
};

const notificationIdForSession = (session: PlannedSession, reason: string) =>
  `${session.id}:${reason}`;

export const generateNotifications = (
  sessions: PlannedSession[],
  states: NotificationState[],
  now: Date = new Date()
): NotificationItem[] => {
  const stateById = new Map(states.map((s) => [s.id, s] as const));
  const notifications: NotificationItem[] = [];
  const nowMs = now.getTime();

  sessions.forEach((session) => {
    if (isSessionCompleted(session.status)) return;
    const sessionDate = parseDateKey(session.date);
    const sessionStart = new Date(sessionDate);
    const [hours, minutes] = session.startTime.split(":").map(Number);
    sessionStart.setHours(hours, minutes, 0, 0);
    const diffMs = sessionStart.getTime() - nowMs;
    const diffHours = diffMs / 3_600_000;

    let severity: NotificationItem["severity"] | null = null;
    let title = "";
    let message = "";
    let reason = "";

    if (diffHours < -1) {
      severity = "urgent";
      title = `Overdue focus block: ${session.subtaskTitle}`;
      message = `This session was scheduled on ${session.date} and still needs attention. Re-run catch-up or mark complete.`;
      reason = "overdue";
    } else if (diffHours <= 0) {
      severity = "urgent";
      title = `Due now: ${session.subtaskTitle}`;
      message = `Your planned session "${session.subtaskTitle}" should be underway.`;
      reason = "due-now";
    } else if (diffHours <= 24) {
      severity = "warning";
      title = `Upcoming (24h): ${session.subtaskTitle}`;
      message = `Starts ${session.startTime} on ${session.date}. Prep any resources now.`;
      reason = "due-soon";
    } else if (diffHours <= 72) {
      severity = "info";
      title = `Heads-up: ${session.subtaskTitle}`;
      message = `Scheduled for ${session.date}. Keep the slot protected.`;
      reason = "heads-up";
    }

    if (!severity) return;
    const id = notificationIdForSession(session, reason);
    const state = stateById.get(id);
    if (state?.snoozedUntil && new Date(state.snoozedUntil).getTime() > nowMs) {
      return;
    }
    if (state?.dismissedAt) {
      const dismissedMs = new Date(state.dismissedAt).getTime();
      if (reason === "heads-up" && nowMs - dismissedMs < 24 * 3_600_000) return;
      if (reason === "due-soon" && nowMs - dismissedMs < 12 * 3_600_000) return;
      if (reason === "due-now" && nowMs - dismissedMs < 6 * 3_600_000) return;
    }

    notifications.push({
      id,
      title,
      message,
      dueDate: session.date,
      sessionId: session.id,
      severity,
      createdAt: now.toISOString(),
    });
  });

  return notifications.sort((a, b) => {
    const severityWeight = { urgent: 0, warning: 1, info: 2 } as Record<
      typeof a.severity,
      number
    >;
    const diff =
      severityWeight[a.severity] - severityWeight[b.severity] ||
      a.dueDate.localeCompare(b.dueDate);
    return diff;
  });
};

export const buildWeeklySummaries = (
  sessions: PlannedSession[],
  now: Date = new Date()
): WeeklyProgress[] => {
  if (!sessions.length) return [];

  const map = new Map<
    string,
    { start: Date; end: Date; planned: number; complete: number }
  >();

  sessions.forEach((session) => {
    const date = parseDateKey(session.date);
    const weekStart = startOfWeek(date);
    const weekEnd = addDays(weekStart, 6);
    const key = formatDateKey(weekStart);
    if (!map.has(key)) {
      map.set(key, {
        start: weekStart,
        end: weekEnd,
        planned: 0,
        complete: 0,
      });
    }
    const entry = map.get(key)!;
    entry.planned += session.durationHours;
    if (isSessionCompleted(session.status)) {
      entry.complete += session.durationHours;
    }
  });

  const summaries: WeeklyProgress[] = Array.from(map.entries())
    .map(([key, entry]) => {
      const ratio =
        entry.planned > 0 ? entry.complete / entry.planned : 1;
      const status =
        ratio >= 0.85
          ? "on-track"
          : ratio >= 0.55
          ? "behind"
          : "at-risk";
      return {
        weekLabel: key,
        startDate: entry.start.toISOString(),
        endDate: entry.end.toISOString(),
        plannedHours: Number(entry.planned.toFixed(2)),
        completedHours: Number(entry.complete.toFixed(2)),
        status,
      };
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  // Ensure current week exists even if empty
  const currentWeekKey = formatDateKey(startOfWeek(now));
  if (!summaries.find((s) => s.weekLabel === currentWeekKey)) {
    const start = startOfWeek(now);
    const end = addDays(start, 6);
    summaries.push({
      weekLabel: currentWeekKey,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      plannedHours: 0,
      completedHours: 0,
      status: "on-track",
    });
  }

  return summaries.sort(
    (a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
};

export { startOfWeek };
