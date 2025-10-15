/// <reference types="@cloudflare/workers-types" />

interface Env {
  OPENAI_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { assessment, rubricText } = (await request.json()) as {
      assessment: { title: string; dueDate: string; weight?: number };
      rubricText?: string;
    };
    if (!assessment?.title || !assessment?.dueDate) {
      return json({ error: "Invalid assessment" }, 400);
    }

    const today = new Date();
    const due = new Date(assessment.dueDate);
    const days = Math.max(1, Math.round((+due - +today) / 86400000));

    const simple = [
      M("Topic & Research Plan", pct(days, 0.10), 2, assessment.title),
      M("Research & Notes",      pct(days, 0.35), 6, assessment.title),
      M("First Draft",           pct(days, 0.60), 6, assessment.title),
      M("Revision & Proofread",  pct(days, 0.85), 3, assessment.title),
      { title: "Finalise & Submit", targetDate: assessment.dueDate, estimateHrs: 1, assessmentTitle: assessment.title },
    ];

    // no key locally? fall back
    if (!env.OPENAI_API_KEY) return json({ milestones: simple, source: "rule-based" });

    const prompt = `
You help plan student assessments.

Assessment:
- Title: ${assessment.title}
- Due: ${assessment.dueDate}
- Weight: ${assessment.weight ?? "unknown"}
${rubricText ? `Rubric:\n${rubricText}\n` : ""}

Propose 4–6 milestone steps (short titles) ordered from now until due date.
Return ONLY JSON array:
[{ "title": "string", "offsetDays": <int>, "estimateHrs": <int> }]
`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
    })});

    if (!r.ok) return json({ milestones: simple, source: "rule-based" });

    const data = await r.json() as any;
    const text = data.choices?.[0]?.message?.content ?? "[]";
    const parsed = JSON.parse(text) as { title:string; offsetDays:number; estimateHrs?:number }[];

    const milestones = parsed.map(m => ({
      title: m.title,
      targetDate: iso(today, clamp(m.offsetDays ?? 0, 0, days)),
      estimateHrs: m.estimateHrs ?? 2,
      assessmentTitle: assessment.title,
    }));

    return json({ milestones, source: "llm" });
  } catch (e: any) {
    return json({ error: e?.message || "Internal error" }, 500);
  }
};

function M(title:string, offset:number, hrs:number, aTitle:string) {
  return { title, targetDate: iso(new Date(), offset), estimateHrs: hrs, assessmentTitle: aTitle };
}
function pct(days:number, p:number){ return Math.ceil(days * p); }
function iso(start:Date, add:number){ const d=new Date(start); d.setDate(d.getDate()+add); return d.toISOString(); }
function clamp(n:number,min:number,max:number){ n=Math.round(Number(n)||0); return Math.max(min,Math.min(max,n)); }
function json(obj:any, status=200){ return new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json" }}); }
