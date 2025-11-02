# PlanPoint (ELEC5620)

PlanPoint is an AI-assisted academic planning platform that ingests assessment schedules, extracts rubric intelligence, and autogenerates milestone-driven study calendars while respecting each student’s availability. Cloning this repository and following the steps below bootstraps a fresh environment—no additional tooling is required beyond Node, npm/pnpm, and Wrangler.

---

## 1. Quick Start

> **Prerequisite:** Request the shared `.env.local` file from the team (contains Firebase, OpenAI, and Cloudflare keys).

1. Download the provided `PlanPoint3-ELEC5620.zip`.
2. Extract it somewhere convenient (e.g., `~/Projects/PlanPoint3-ELEC5620`).

```bash
cd ~/Projects/PlanPoint3-ELEC5620
cp /path/to/shared/.env.local web/.env.local
```

### Terminal 1 – Vite dev server

```bash
cd PlanPoint3-ELEC5620/web
npm install            # or pnpm install
npm run dev            # serves on http://localhost:5173
```

### Terminal 2 – Cloudflare Pages functions proxy

```bash
cd PlanPoint3-ELEC5620/web
npx wrangler pages dev --proxy 5173 --compatibility-date=2025-10-15
```

**Open the app:** [http://localhost:8788](http://localhost:8788)

_(Stick with the package manager you install with to avoid lockfile churn; `pnpm-lock.yaml` is provided.)_

---

## 2. System Overview

- **Schedule Ingestion (UC1):** Upload CSV assessment schedules, attach PDF specs/rubrics, import ICS availability, and edit rows inline before saving to Firestore.
- **Milestone Generation (UC2):** Uses OpenAI GPT-4o-mini to transform assessment + rubric/spec context into milestones with descriptions, target dates, and effort estimates.
- **Planner (UC3):** Builds a 7-day rolling study calendar, respects busy blocks and preferences, and surfaces the LLM-authored guidance inside each study session.
- **Progress Dashboard (UC4 / UC5):** Summarises progress, upcoming reminders, and completion KPIs; nudges students when a new plan is required.
- **Catch-up Reschedule (UC6):** Auto-detects overdue sessions, recomputes the plan respecting preferences and availability, and shows an inline change log plus Apply button so students can commit the new version after reviewing the moves.

### Architecture at a Glance

- React + TypeScript (Vite) front-end (`web/src`)
- Firebase Firestore & Storage + Firebase Auth
- Cloudflare Pages functions (`web/functions`) for serverless APIs
- OpenAI LLM for milestone extraction & task detail enrichment
- pdfjs-dist + ICS parser for document/calendar ingestion

---

## 3. Configuration Map

| Item                  | Location                                   | Notes                                                                  |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| Environment variables | `web/.env.local`                           | Copy from shared source; never commit.                                 |
| Firebase init         | `web/src/firebase.ts`                      | Reads values from `.env.local`.                                        |
| LLM API               | `web/functions/api/generate-milestones.ts` | Calls OpenAI with rubric/spec text.                                    |
| Domain types          | `web/src/types.ts`                         | Shared definitions for assessments, milestones, sessions, busy blocks. |
| Planner engine        | `web/src/lib/planner.ts`                   | Scheduling logic, catch-up reschedule helpers.                         |

---

## 4. Build & Deployment

```bash
cd PlanPoint3-ELEC5620/web
npm run build          # production bundle
npm run preview        # optional local preview

# Deploy to Cloudflare Pages (requires project + env vars set up)
npx wrangler pages deploy --project-name planpoint --branch main
```

Ensure the Cloudflare project mirrors `.env.local` values.

Anyone can then run the PlanPoint web application through this link: https://planpoint3-elec5620.pages.dev

---

## 5. Advanced Technologies

1. **OpenAI GPT-4o-mini** – Milestone generation & task descriptions.
2. **Firebase Firestore** – Realtime data for assessments, milestones, planner sessions, busy blocks.
3. **Firebase Storage** – Secure storage of PDF specs/rubrics.
4. **Cloudflare Pages Functions** – Serverless LLM proxy + ingestion helpers.
5. **pdfjs-dist** – Client-side PDF parsing.
6. **ICS parser (`ical.js`)** – Converts calendars to busy blocks.
7. **TypeScript** – End-to-end type safety across app and APIs.
8. **Modern React stack** – Hooks, memoisation, modular components.

All are fully integrated and verified via manual QA.

---

## 6. LLM Agent Details & Impact

- **Endpoint**: `/api/generate-milestones`
- **Inputs**: Assessment metadata + concatenated rubric/spec text (20k character cap)
- **Outputs**: Title, target date, hours estimate, and rich milestone description
- **Validation**: Schema guards before Firestore writes; trimming & dedupe to prevent runaway output
- **Downstream usage**:
  - Milestone cards display the LLM-produced titles/descriptions.
  - Planner sessions inherit those descriptions, so clicking a task shows AI-authored guidance on what to do.
  - Catch-up warnings and risk badges reference the same milestone context to explain why work is at risk.
- **Iterations**: Prompt tuning across sprints differentiated rubric vs. spec text, improved word limits, and accounted for user feedback from testing PDFs. The result is a measurable improvement in the clarity of the student’s study plan.

---

## 7. Agile Delivery & Jira (3 Sprints)

- **Sprint 1** – Schedule ingestion MVP, Firebase scaffolding, CSV import baseline
- **Sprint 2** – LLM milestone engine, PDF ingestion, milestone UX, first Planner prototype
- **Sprint 3** – Catch-up reschedule enhancements, planner polish, progress dashboard, QA hardening

Artefacts available in our Jira board:

- Sprint goals, burndown charts, demo recordings
- User stories with acceptance criteria & story points
- Retrospectives documenting feedback loops and action items

---

## 8. Contribution Workflow & Team Roles

- Branch from `main` using `feature/<summary>` or `bugfix/<summary>`.
- Run `npm run build` before pushing to ensure the bundle stays healthy.
- Open PRs with linked Jira story, screenshots/GIFs, and manual checklist results.
- At least one teammate reviews before merge.

**Team contributions**

- **Bianca Douroudis** – Lead implementation across ingestion, milestones, planner, and catch-up; LLM prompt tuning; UI polish.
- **Simon Bolger** – Firebase and Cloudflare setup, deployment pipeline, environment scaffolding, build tooling.
- **Sam Kertesz** – Sign-up/login flows, UI refinements, end-to-end testing, Jira coordination.
- **Chris Hu** – Jira board ownership, sprint tracking, QA coordination and feedback.

---

## 9. Future Enhancements

- Automated Jest + Playwright suites
- "What-if" sandbox planning scenarios
- Email/push notifications for overdue milestones
- Analytics correlating LLM-generated workload with actual completion

---
