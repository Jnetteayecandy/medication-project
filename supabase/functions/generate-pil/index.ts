// =============================================================================
// Supabase Edge Function: generate-pil
// Drafts a Thai Patient Information Leaflet (7 standard sections) with Claude.
//
// - The Anthropic API key lives only here, as the secret ANTHROPIC_API_KEY.
// - Only users with an ADMIN / PHARMACIST / STAFF profile can call it, with a
//   daily limit per user (AI_DAILY_LIMIT, default 30). Each call is logged to
//   activity_logs as 'ai_generate'.
// - Optional web search lets Claude look up the manufacturer's leaflet / product
//   information; the sources it used are returned so the pharmacist can check them.
// - The result is a DRAFT. The app requires the pharmacist to approve it before saving.
//
// Deploy:  supabase functions deploy generate-pil --no-verify-jwt
// Secrets: supabase secrets set ANTHROPIC_API_KEY=...   (optional: PIL_AI_MODEL,
//          PIL_AI_EFFORT, AI_DAILY_LIMIT)
// =============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.95.3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("PIL_AI_MODEL") ?? "claude-opus-5-5";
const EFFORT = (Deno.env.get("PIL_AI_EFFORT") ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "30");
const ALLOWED_ROLES = ["ADMIN", "PHARMACIST", "STAFF"];

const SYSTEM_PROMPT = `You draft Thai-language Patient Information Leaflets (PIL, เอกสารกำกับยาสำหรับประชาชน) for a hospital pharmacy system. A licensed pharmacist reviews and approves every draft before it is published to patients, so your job is to give them an accurate, complete, easy-to-check starting point.

Write for patients: plain, polite Thai at a lay reading level, short sentences, no jargon (explain medical terms briefly when needed). Follow the structure of the Thai FDA standard leaflet, with exactly these 7 sections:
1. ยานี้คืออะไร - what the medicine is and what it is used for
2. ข้อควรรู้ก่อนใช้ยา - 2.1 ห้ามใช้ยานี้เมื่อไร (contraindications), 2.2 ข้อควรระวัง (precautions; tell the doctor/pharmacist if ...)
3. วิธีใช้ยา - 3.1 how/when to take it and the usual dose, 3.2 หากลืมกินยาควรทำอย่างไร, 3.3 ถ้ากินยานี้เกินขนาดที่แนะนำ ควรทำอย่างไร
4. ข้อควรปฏิบัติระหว่างใช้ยา - what to do or avoid while using it
5. อันตรายที่อาจเกิดจากยา - 5.1 serious effects: stop and see a doctor immediately, 5.2 other effects: see a doctor if severe
6. ควรเก็บยาอย่างไร - storage
7. ลักษณะและส่วนประกอบของยา - appearance, active ingredient and strength, pack size, manufacturer

Formatting inside each section: one item per line, items start with "• ", and numbered sub-headings such as "2.1 ห้ามใช้ยานี้เมื่อไร" go on their own line without a bullet. Do not repeat the section title inside the section text.

Accuracy matters more than completeness. Base the content on established product information for this active ingredient and, when web search is available, on the manufacturer's leaflet or the Thai FDA / product registration information for the specific product. Product-specific details (tablet colour and shape, inactive ingredients, pack size, registration number, the manufacturer's own storage temperature) must come from a source you actually found; when you could not confirm one, write it as "[โปรดตรวจสอบ: ...]" in the text and add a note to "caveats" rather than guessing. List every web page you relied on in "sources".

When you are finished, call the submit_pil tool exactly once with the complete leaflet.`;

const SUBMIT_PIL_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_pil",
  description:
    "Submit the finished Thai PIL draft. Call this once, at the end, with all 7 sections filled in.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      med_name: {
        type: "string",
        description: "Leaflet title: medicine name and strength, in Thai, e.g. \"แคปโทพริล ความแรง 25 มิลลิกรัม\"",
      },
      dosage_form: { type: "string", description: "Dosage form in Thai, e.g. \"ชนิดเม็ด\"" },
      section_1: { type: "string", description: "1. ยานี้คืออะไร" },
      section_2: { type: "string", description: "2. ข้อควรรู้ก่อนใช้ยา" },
      section_3: { type: "string", description: "3. วิธีใช้ยา" },
      section_4: { type: "string", description: "4. ข้อควรปฏิบัติระหว่างใช้ยา" },
      section_5: { type: "string", description: "5. อันตรายที่อาจเกิดจากยา" },
      section_6: { type: "string", description: "6. ควรเก็บยาอย่างไร" },
      section_7: { type: "string", description: "7. ลักษณะและส่วนประกอบของยา" },
      sources: {
        type: "array",
        description: "Web pages used (empty if none)",
        items: {
          type: "object",
          properties: { title: { type: "string" }, url: { type: "string" } },
          required: ["title", "url"],
          additionalProperties: false,
        },
      },
      caveats: {
        type: "array",
        description: "Points the pharmacist should verify (in Thai or English)",
        items: { type: "string" },
      },
    },
    required: [
      "med_name", "dosage_form",
      "section_1", "section_2", "section_3", "section_4", "section_5", "section_6", "section_7",
      "sources", "caveats",
    ],
    additionalProperties: false,
  },
};

type PilDraft = {
  med_name: string;
  dosage_form: string;
  section_1: string;
  section_2: string;
  section_3: string;
  section_4: string;
  section_5: string;
  section_6: string;
  section_7: string;
  sources: { title: string; url: string }[];
  caveats: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function clean(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "The AI service is not configured yet (missing ANTHROPIC_API_KEY secret)." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const medName = clean(body.med_name, 200);
  const strength = clean(body.strength, 100);
  const dosageForm = clean(body.dosage_form, 100);
  const company = clean(body.company, 200);
  const notes = clean(body.notes, 1500);
  const useWebSearch = body.use_web_search !== false;
  if (!medName) return json({ error: "Please enter a medication name." }, 400);

  // --- Who is calling? Prefer a real Supabase Auth session, else the app's user id ---
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let userId: string | null = null;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) userId = data.user.id;
  }
  if (!userId && typeof body.user_id === "string") userId = body.user_id;
  if (!userId) return json({ error: "Please sign in to use AI generation." }, 401);

  const { data: profile } = await admin.from("profiles").select("id, name, email, role").eq("id", userId).maybeSingle();
  const role = String(profile?.role ?? "").trim().toUpperCase();
  if (!profile || !ALLOWED_ROLES.includes(role)) {
    return json({ error: "Your account is not allowed to use AI generation." }, 403);
  }

  // --- Daily limit per user ---
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("activity_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "ai_generate")
    .gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) {
    return json({ error: `Daily AI limit reached (${DAILY_LIMIT} per 24 hours). Please try again later.` }, 429);
  }

  // --- Ask Claude ---
  const request = [
    `Medicine: ${medName}`,
    strength && `Strength: ${strength}`,
    dosageForm && `Dosage form: ${dosageForm}`,
    company && `Manufacturer / company: ${company}`,
    notes && `Notes from the pharmacist: ${notes}`,
    useWebSearch
      ? "Search for this specific product's leaflet or product information first, then write the draft."
      : "Web search is not available for this request; write from established product information and mark product-specific details for verification.",
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey });
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...(useWebSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 6 }] : []),
    SUBMIT_PIL_TOOL,
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: request }];
  const foundSources = new Map<string, string>();
  let draft: PilDraft | null = null;
  let usedModel = MODEL;

  try {
    for (let turn = 0; turn < 5 && !draft; turn++) {
      const message = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: EFFORT },
          system: SYSTEM_PROMPT,
          tools,
          tool_choice: { type: "auto" },
          messages,
        })
        .finalMessage();
      usedModel = message.model;

      for (const block of message.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const result of block.content) {
            if (result.type === "web_search_result") foundSources.set(result.url, result.title);
          }
        }
        if (block.type === "tool_use" && block.name === "submit_pil") draft = block.input as PilDraft;
      }
      if (draft) break;

      if (message.stop_reason === "refusal") {
        return json({ error: "The AI declined this request. Please rephrase it or write the leaflet manually." }, 422);
      }
      if (message.stop_reason === "max_tokens") {
        return json({ error: "The AI response was too long. Please try again." }, 502);
      }

      messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason !== "pause_turn") {
        // Finished without submitting: ask once more for the tool call
        messages.push({ role: "user", content: "Please call submit_pil now with the complete leaflet." });
      }
    }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "The AI service is busy. Please try again in a minute." }, 429);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return json({ error: "The AI service key is invalid. Please contact the administrator." }, 500);
    }
    if (err instanceof Anthropic.APIError) {
      return json({ error: `AI service error (${err.status}): ${err.message}` }, 502);
    }
    return json({ error: `AI request failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (!draft) return json({ error: "The AI did not return a leaflet. Please try again." }, 502);

  // Sources: what Claude cited, plus any search results it did not list
  const sources = [...(draft.sources ?? [])];
  for (const [url, title] of foundSources) {
    if (!sources.some((s) => s.url === url)) sources.push({ title, url });
  }

  await admin.from("activity_logs").insert({
    user_id: userId,
    user_name: profile.name ?? profile.email,
    user_role: role,
    action: "ai_generate",
    target_table: "medication_templates",
    target_name: draft.med_name || medName,
    changes: { request: { med_name: medName, strength, dosage_form: dosageForm, company }, model: usedModel },
  });

  return json({
    med_name: draft.med_name,
    med_type: draft.dosage_form,
    contents: [
      "",
      draft.section_1, draft.section_2, draft.section_3, draft.section_4,
      draft.section_5, draft.section_6, draft.section_7,
    ],
    sources: sources.slice(0, 15),
    caveats: draft.caveats ?? [],
    model: usedModel,
  });
});
