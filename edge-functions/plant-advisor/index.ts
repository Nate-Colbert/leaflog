// @ts-nocheck
// Leaflog "plant-advisor": plant identification, care guides and "Ask Claude".
// Runs on Supabase Edge Functions. Your Anthropic API key lives in a Supabase secret, never in the web page.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const IDENTIFY_SYSTEM = `You are an expert houseplant botanist and care advisor. Look at the photo and identify the plant, then give practical indoor care guidance.
Reply with ONE JSON object only. No prose before or after it and no code fences. Use exactly these keys:
{
  "common_name": string,
  "species": string (botanical name, or "" if unsure),
  "confidence": "high" | "medium" | "low",
  "summary": string (1-2 sentences: what it is and the key to keeping it happy),
  "light_level": "low" | "medium" | "bright" | "direct",
  "water_every_days": integer (typical days between waterings for a normal indoor home in the growing season),
  "water_notes": string (e.g. how dry the soil should get first),
  "flex": "strict" | "normal" | "hardy"  (strict = hates drying out, hardy = tolerates drying out well, normal = in between),
  "feed_every_weeks": integer or null (growing-season feeding interval),
  "soil_mix": string (a good potting mix),
  "humidity": string,
  "needs_pole": boolean (true if it is a climber that benefits from a moss pole),
  "pole_notes": string (empty if not needed),
  "pet_safe": boolean or null,
  "watch_for": array of short strings (common problems)
}
If you cannot identify the plant, still fill the keys with your best general guess, set confidence to "low" and say so in summary.`;

const ADVICE_SYSTEM = `You are a friendly, practical houseplant expert. The owner shares their plant's care log and an optional photo, plus a question.
Give concise, specific advice (under 250 words). Plain text with short paragraphs, no markdown headings. Base it on the log where you can (watering rhythm, soil notes, problems, light), say what you can't tell from the data, and suggest at most 3 concrete changes. This is advice, not a diagnosis.`;

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { /* try harder */ }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { /* fall through */ } }
  throw new Error("Claude's reply wasn't in the expected format. Try again.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Who is calling? Only a signed-in Leaflog user may use this (and it costs you API credit).
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"));
    const { data: u, error: uerr } = await sb.auth.getUser(token);
    if (uerr || !u || !u.user) return json({ error: "Please sign in again." }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set. Add it under Edge Functions > Secrets in Supabase." }, 500);
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

    const body = await req.json();
    const mode = body.mode === "advice" ? "advice" : "identify";
    if (body.image && body.image.length > 7_000_000) return json({ error: "That photo is too large." }, 413);

    const content = [];
    if (body.image) content.push({ type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image } });
    if (mode === "identify") {
      content.push({ type: "text", text: `Identify this plant and give indoor care guidance.${body.hint ? ` The owner's name for it is "${String(body.hint).slice(0, 80)}".` : ""}` });
      if (!body.image) return json({ error: "Add a photo first." }, 400);
    } else {
      content.push({ type: "text", text: `Here is my plant's care log:\n\n${String(body.plant || "").slice(0, 6000)}\n\nMy question: ${String(body.question || "How is it doing?").slice(0, 600)}` });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: mode === "identify" ? 1000 : 700,
        system: mode === "identify" ? IDENTIFY_SYSTEM : ADVICE_SYSTEM,
        messages: [{ role: "user", content }],
      }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: (out && out.error && out.error.message) || `Claude API error (${r.status})` }, 502);
    const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (mode === "identify") return json({ result: parseJson(text) });
    return json({ result: { advice: text } });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
});
