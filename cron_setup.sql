-- Leaflog: run the morning-summary function every hour (it only sends at YOUR chosen hour).
-- 1. In Supabase: Database > Extensions, switch on "pg_cron" and "pg_net".
-- 2. Replace the two placeholders below (project ref = the bit before .supabase.co in your URL,
--    secret = the same CRON_SECRET value you saved under Edge Functions > Secrets).
-- 3. Paste into the SQL Editor and Run.

select cron.unschedule('leaflog-daily-summary')
where exists (select 1 from cron.job where jobname = 'leaflog-daily-summary');

select cron.schedule(
  'leaflog-daily-summary',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-summary',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
