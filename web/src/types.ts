export type Assessment = {
  title: string;
  dueDate: string;
  weight?: number;
  course?: string;
  notes?: string;
  specUrl?: string;
  specPath?: string;
  specName?: string;
  specText?: string;
  rubricUrl?: string;
  rubricPath?: string;
  rubricName?: string;
  rubricText?: string;
};
export type Milestone = {
  id?: string;
  title: string;
  targetDate: string;
  estimateHrs?: number;
  assessmentTitle: string;
  assessmentDueDate?: string;
};

export type BusyBlock = {
  id: string;
  title: string;
  start: string;
  end: string;
};

export type PlannerPreferences = {
  dailyCapHours: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  focusBlockMinutes: number;
  allowWeekends: boolean;
  startHour: number;
  endHour: number;
};

export type SessionStatus = "planned" | "in-progress" | "completed" | "todo"; // include the two you actually plan to use

export type RiskLevel = "on-track" | "warning" | "late" | "at-risk"; // include "late" and "at-risk"

export type PlannedSession = {
  id: string;
  assessmentTitle: string;
  assessmentDueDate: string;
  milestoneTitle: string;
  subtaskTitle: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationHours: number;
  status: SessionStatus;
  notes?: string;
  riskLevel: RiskLevel;
  version: number;
  createdAt: string;
  updatedAt: string;
  blockedBy?: string;
  rolledFromDate?: string;
};

export type PlanWarningType = "capacity" | "deadline" | "conflict" | "info";

export type PlanWarning = {
  type: PlanWarningType;
  message: string;
  detail?: string;
};

export type DaySummary = {
  date: string;
  isWeekend: boolean;
  capacity: number;
  totalHours: number;
  sessions: PlannedSession[];
};

export type PlanResult = {
  sessions: PlannedSession[];
  days: DaySummary[];
  warnings: PlanWarning[];
  unplaced: PlannedSession[];
  version: number;
};

export type NotificationSeverity = "info" | "warning" | "urgent";

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  dueDate: string;
  sessionId?: string;
  severity: NotificationSeverity;
  createdAt: string;
};

export type NotificationState = {
  id: string;
  dismissedAt?: string;
  snoozedUntil?: string;
};

export type WeeklyProgress = {
  weekLabel: string;
  startDate: string;
  endDate: string;
  plannedHours: number;
  completedHours: number;
  status: "on-track" | "behind" | "at-risk";
};

export type PlanSession = {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  durationHours: number;
  assessmentTitle: string;
  assessmentDueDate: string; // YYYY-MM-DD
  milestoneTitle: string;
  subtaskTitle: string;
  notes?: string;
  riskLevel: "on-track" | "warning" | "late";
  done?: boolean; // ← add this
};

export type ProgressAuditAction = "status-change" | "reschedule";

export type ProgressAudit = {
  id?: string;
  action: ProgressAuditAction;
  sessionId?: string;
  sessionTitle?: string;
  assessmentTitle?: string;
  beforeStatus?: SessionStatus;
  afterStatus?: SessionStatus;
  note?: string;
  createdAt: string;
};
