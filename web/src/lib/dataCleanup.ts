import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Milestone } from "../types";

const NOTIFICATION_REASONS = ["overdue", "due-now", "due-soon", "heads-up"];

export type AssessmentRef = {
  title: string;
  dueDate?: string | null;
};

export async function cascadeDeleteAssessments(
  uid: string,
  assessments: AssessmentRef[]
) {
  for (const assessment of assessments) {
    await purgeAssessmentData(uid, assessment);
  }
}

export async function cascadeDeleteMilestone(
  uid: string,
  milestone: Pick<Milestone, "assessmentTitle" | "title">
) {
  const sessionIds = await deletePlanSessions(uid, [
    where("assessmentTitle", "==", milestone.assessmentTitle),
    where("milestoneTitle", "==", milestone.title),
  ]);
  await deleteNotificationStates(uid, sessionIds);
  await deleteAuditEntriesBySession(uid, sessionIds);
}

async function purgeAssessmentData(uid: string, assessment: AssessmentRef) {
  const constraints = buildAssessmentConstraints(assessment);
  if (!constraints.length) return;
  await deleteMilestones(uid, constraints);

  const sessionIds = await deletePlanSessions(uid, constraints);
  await deleteNotificationStates(uid, sessionIds);
  if (sessionIds.length) {
    await deleteAuditEntriesBySession(uid, sessionIds);
  } else {
    await deleteAuditEntriesByAssessment(uid, assessment.title);
  }
}

function buildAssessmentConstraints(assessment: AssessmentRef): QueryConstraint[] {
  if (!assessment.title) return [];
  return [where("assessmentTitle", "==", assessment.title)];
}

async function deleteMilestones(uid: string, constraints: QueryConstraint[]) {
  const col = collection(db, "users", uid, "milestones");
  const snap = await getDocs(query(col, ...constraints));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
}

async function deletePlanSessions(uid: string, constraints: QueryConstraint[]) {
  const col = collection(db, "users", uid, "planSessions");
  const snap = await getDocs(query(col, ...constraints));
  if (snap.empty) return [];

  const batch = writeBatch(db);
  snap.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
  return snap.docs.map((docSnap) => docSnap.id);
}

async function deleteNotificationStates(uid: string, sessionIds: string[]) {
  if (!sessionIds.length) return;
  const col = collection(db, "users", uid, "notificationStates");
  const batch = writeBatch(db);
  sessionIds.forEach((sessionId) => {
    NOTIFICATION_REASONS.forEach((reason) => {
      batch.delete(doc(col, `${sessionId}:${reason}`));
    });
  });
  await batch.commit();
}

async function deleteAuditEntriesByAssessment(uid: string, assessmentTitle: string) {
  const col = collection(db, "users", uid, "progressAudit");
  const snap = await getDocs(query(col, where("assessmentTitle", "==", assessmentTitle)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
}

async function deleteAuditEntriesBySession(uid: string, sessionIds: string[]) {
  if (!sessionIds.length) return;
  const col = collection(db, "users", uid, "progressAudit");
  const chunks = chunk(sessionIds, 10);
  for (const group of chunks) {
    const snap = await getDocs(query(col, where("sessionId", "in", group)));
    if (snap.empty) continue;
    const batch = writeBatch(db);
    snap.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
