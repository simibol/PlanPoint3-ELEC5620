/// <reference types="@cloudflare/workers-types" />

interface Env { OPENAI_API_KEY?: string; }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { assessment, rubricText } = await request.json() as {
      assessment: { title: string; dueDate: string; weight?: number };
      rubricText?: string;
    };
    if (!assessment?.title || !assessment?.dueDate) {
      return json({ error: "Invalid assessment" }, 400);
    }

    const today = new Date();
    const due = new Date(assessment.dueDate);
    const days = Math.max(1, Math.round((+due - +today) / 86_400_000));

    const simple = [
      M("Topic & Research Plan", pct(days, 0.10), 2, assessment, today),
      M("Research & Notes",      pct(days, 0.35), 6, assessment, today),
      M("First Draft",           pct(days, 0.60), 6, assessment, today),
      M("Revision & Proofread",  pct(days, 0.85), 3, assessment, today),
      {
        title: "Finalise & Submit",
        targetDate: assessment.dueDate,
        estimateHrs: 1,
        assessmentTitle: assessment.title,
        assessmentDueDate: assessment.dueDate,
      },
    ];

    if (!env.OPENAI_API_KEY) {
      console.log("[AI] no key → rule-based");
      return json({ milestones: simple, source: "rule-based" });
    }

    const rubricSummary = summariseRubric(rubricText ?? "", 2200);

    // ---- Prompt (explicit, but compact)
    const system =
      "You are an academic planning assistant. Respond with JSON only – no prose, preambles, or code fences.";
    const user = `Assessment context:
- Title: ${assessment.title}
- Due date (ISO): ${assessment.dueDate}
- Days remaining (today inclusive): ${days}
- Weight/importance: ${assessment.weight ?? "unknown"}
${
  rubricSummary
    ? `- Rubric highlights (summarised):
${rubricSummary
  .split("\n")
  .map((line) => `  • ${line}`)
  .join("\n")}`
    : "- Rubric highlights: (not supplied)"
}

Produce between 6 and 10 milestone steps that explicitly cover these rubric expectations and spread the workload from now until the due date.

Strict requirements for the JSON:
1. Each milestone object must include "title", "offsetDays", and "estimateHrs".
2. offsetDays are integers counting days from today (0 = today). They must be strictly increasing and the final milestone must have offsetDays = ${days}.
3. Titles must be descriptive (≤ 70 characters) and map to the rubric sections or subsections (e.g. Part A.i Research, Part B Reflection). If the rubric lists major parts or criteria, provide at least one milestone for each part; include separate milestones for notable sub-parts where appropriate.
4. estimateHrs must be between 1 and 12 and represent realistic effort; total hours should roughly scale with the assessment weight.
5. Ensure the milestones collectively cover research/planning, drafting/building, synthesis, editing, and submission tasks aligned with the rubric. The target dates should progress steadily toward the deadline (e.g. research early, drafting mid-way, refinement shortly before submission, submission on the due date).

Valid response shapes:
- [ { "title": "...", "offsetDays": <int>, "estimateHrs": <int> }, ... ]
- { "milestones": [ { "title": "...", "offsetDays": <int>, "estimateHrs": <int> }, ... ] }
`.trim();

    // ---- Call OpenAI with tiny retry/backoff on 429/5xx
    const data = await callOpenAIWithRetry(env.OPENAI_API_KEY!, system, user, 2);
    if (!data.ok) {
      console.log("[AI] HTTP error", data.status, data.body?.slice?.(0, 400));
      return json({ milestones: simple, source: "llm-error", status: data.status });
    }

    const raw = data.json?.choices?.[0]?.message?.content ?? "";
    const cleaned = stripCodeFence(String(raw));
    console.log("[AI] RAW first 200:", cleaned.slice(0, 200)); // helps diagnose parser issues

    // ---- Parse defensively (extract first JSON block only)
    let arr: any[] | null = null;
    try {
      const extracted = extractFirstJson(cleaned);          // returns only {...} or [...]
      const parsed = JSON.parse(extracted);                 // parse just that slice
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (Array.isArray((parsed as any).milestones)) {
        arr = (parsed as any).milestones;
      } else if (Array.isArray((parsed as any).steps)) {
        arr = (parsed as any).steps;
      } else {
        throw new Error("No array found in response JSON");
      }
    } catch (e) {
      console.log("[AI] parse failed:", (e as Error).message);
      return json({ milestones: simple, source: "llm-parse-failed" });
    }

    if (!arr?.length) {
      console.log("[AI] empty milestones from LLM → fallback");
      return json({ milestones: simple, source: "llm-empty" });
    }

    const milestones = arr.map((m: any) => ({
      title: String(m?.title ?? "Untitled"),
      targetDate: iso(today, clamp(m?.offsetDays ?? 0, 0, days)),
      estimateHrs: clamp(m?.estimateHrs ?? 2, 1, 24),
      assessmentTitle: assessment.title,
      assessmentDueDate: assessment.dueDate,
    }));

    console.log("[AI] used OpenAI for:", assessment.title, "→", milestones.length, "items");
    return json({ milestones, source: "llm", usedOpenAI: true, model: "gpt-4o-mini" });

  } catch (e) {
    console.error("[generate-milestones] unhandled error:", e);
    const message = e instanceof Error ? e.message : "Internal error";
    return json({ error: message }, 500);
  }
};

/* ----------------- helpers ----------------- */

async function callOpenAIWithRetry(
  apiKey: string,
  system: string,
  user: string,
  retries = 2
): Promise<{ ok: boolean; status: number; json?: any; body?: string }> {
  let attempt = 0;
  let delay = 400; // ms
  while (true) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (r.ok) {
      return { ok: true, status: r.status, json: await r.json() };
    }

    // 429 / 5xx → backoff & retry
    if ((r.status === 429 || r.status >= 500) && attempt < retries) {
      await sleep(delay);
      attempt++;
      delay *= 2;
      continue;
    }

    const body = await safeText(r);
    return { ok: false, status: r.status, body: body ?? undefined };
  }
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function M(
  title: string,
  offset: number,
  hrs: number,
  assessment: { title: string; dueDate: string },
  start: Date
) {
  return {
    title,
    targetDate: iso(start, offset),
    estimateHrs: hrs,
    assessmentTitle: assessment.title,
    assessmentDueDate: assessment.dueDate,
  };
}
function pct(days: number, p: number) { return Math.ceil(days * p); }
function iso(start: Date, add: number) { const d = new Date(start); d.setDate(d.getDate() + add); return d.toISOString(); }
function clamp(n: number, min: number, max: number) { n = Math.round(Number(n) || 0); return Math.max(min, Math.min(max, n)); }
function json(obj: any, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }); }
async function safeText(r: Response) { try { return await r.text(); } catch { return null; } }

function stripCodeFence(s: string) {
  // trim leading/trailing ```json ... ``` if present
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function summariseRubric(text: string, limit = 2200) {
  if (!text) return "";
  const cleaned = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  for (const raw of cleaned) {
    const line = raw.trim();
    if (!line) continue;
    // prioritise numbered headings or bullet-like lines
    if (/^([0-9A-Z]{1,3}[\).\s-]+|[-•*]\s+)/.test(line) || line.length > 50) {
      lines.push(line);
    }
    if (lines.join("\n").length >= limit) break;
  }
  if (!lines.length) {
    return cleaned.slice(0, 40).join("\n").slice(0, limit);
  }
  const summary = lines.join("\n");
  return summary.length > limit ? summary.slice(0, limit) : summary;
}

function extractFirstJson(s: string) {
  // find the first {...} or [...] top-level block, ignoring quoted text
  const startObj = s.indexOf("{");
  const startArr = s.indexOf("[");
  let start = -1, open = "", close = "";
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) { start = startObj; open = "{"; close = "}"; }
  else if (startArr !== -1) { start = startArr; open = "["; close = "]"; }
  else { throw new Error("No JSON object/array found"); }
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
  }
  throw new Error("Unbalanced JSON");
}
