// @ts-nocheck
// Leaflog "sensor-ingest": receives temperature / humidity / soil-moisture readings and stores them for the iPad hub.
// Anything that can send an HTTPS POST can feed it (a Govee poller, Home Assistant, a small script, an ESP32...).
//
// POST https://<project>.supabase.co/functions/v1/sensor-ingest
// Header:  x-ingest-secret: <INGEST_SECRET>
// Body:    { "readings": [
//            { "room": "Living room", "kind": "temp_c",   "value": 23.4, "device": "Govee H5075" },
//            { "room": "Living room", "kind": "humidity", "value": 58 },
//            { "plant": "Monty", "kind": "soil_moisture", "value": 41, "at": "2026-10-15T05:00:00Z" } ] }
// Secrets needed: INGEST_SECRET (any long random text) and INGEST_USER_ID (your user id: Authentication > Users).
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const KINDS = ["temp_c", "humidity", "soil_moisture"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const secret = Deno.env.get("INGEST_SECRET"), uid = Deno.env.get("INGEST_USER_ID");
  if (!secret || !uid) return json({ error: "INGEST_SECRET / INGEST_USER_ID not set" }, 500);
  if (req.headers.get("x-ingest-secret") !== secret) return json({ error: "Not allowed" }, 401);
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const body = await req.json();
    const list = Array.isArray(body.readings) ? body.readings.slice(0, 200) : [];
    const [{ data: rooms }, { data: plants }] = await Promise.all([
      sb.from("rooms").select("id,name").eq("user_id", uid),
      sb.from("plants").select("id,name,room_id").eq("user_id", uid),
    ]);
    const norm = (s) => String(s || "").trim().toLowerCase();
    const rows = [], skipped = [];
    for (const r of list) {
      const value = Number(r.value);
      if (!KINDS.includes(r.kind) || !Number.isFinite(value)) { skipped.push({ reason: "bad kind/value", r }); continue; }
      const room = r.room ? (rooms || []).find((x) => norm(x.name) === norm(r.room)) : null;
      const plant = r.plant ? (plants || []).find((x) => norm(x.name) === norm(r.plant)) : null;
      if ((r.room && !room) || (r.plant && !plant) || (!r.room && !r.plant)) { skipped.push({ reason: "unknown room/plant", r }); continue; }
      rows.push({
        user_id: uid, kind: r.kind, value, device: r.device || null,
        room_id: room ? room.id : (plant ? plant.room_id : null), plant_id: plant ? plant.id : null,
        recorded_at: r.at ? new Date(r.at).toISOString() : new Date().toISOString(),
      });
    }
    if (rows.length) { const { error } = await sb.from("sensor_readings").insert(rows); if (error) throw error; }
    // keep the table small: drop anything older than 90 days
    await sb.from("sensor_readings").delete().eq("user_id", uid).lt("recorded_at", new Date(Date.now() - 90 * 864e5).toISOString());
    return json({ ok: true, stored: rows.length, skipped });
  } catch (e) { return json({ error: e.message || String(e) }, 500); }
});
