
/* ---------------------------------------------------------------- handler */
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function fetchAll(sb, table, userId) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select("*").eq("user_id", userId).range(from, from + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const body = await req.json().catch(() => ({}));

    // Two ways in: the hourly schedule (secret header) or you tapping "Send a test" in the app (your login).
    const secret = Deno.env.get("CRON_SECRET");
    let testUser = null;
    const provided = req.headers.get("x-cron-secret");
    if (provided && secret && provided === secret) { /* scheduled run */ }
    else if (body.test) {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data } = await sb.auth.getUser(token);
      if (!data || !data.user) return json({ error: "Please sign in again." }, 401);
      testUser = data.user.id;
    } else return json({ error: "Not allowed" }, 401);

    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv) return json({ error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets are not set." }, 500);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:you@example.com", pub, priv);

    let q = sb.from("user_settings").select("*").eq("push_enabled", true);
    if (testUser) q = q.eq("user_id", testUser);
    const { data: users, error } = await q;
    if (error) throw error;

    const now = new Date(), report = [];
    for (const row of users || []) {
      const tz = row.timezone || "UTC";
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (!testUser && (hour !== row.notify_hour || row.last_notified_on === today)) continue;

      const settings = normSettings(row);
      const [plants, events] = await Promise.all([fetchAll(sb, "plants", row.user_id), fetchAll(sb, "events", row.user_id)]);
      const sum = summarizeDue(allStats(plants, events, settings, today, tz), settings, today);
      if (!testUser && sum.count === 0) { await sb.from("user_settings").update({ last_notified_on: today }).eq("user_id", row.user_id); continue; }

      const { data: subs } = await sb.from("push_subscriptions").select("*").eq("user_id", row.user_id);
      let sent = 0;
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: sum.title, body: sum.body, url: "./" }));
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
          else console.error("push failed", e.statusCode, e.body || e.message);
        }
      }
      if (!testUser) await sb.from("user_settings").update({ last_notified_on: today }).eq("user_id", row.user_id);
      report.push({ user: row.user_id, due: sum.count, sent });
    }
    return json({ ok: true, report });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || String(e) }, 500);
  }
});
