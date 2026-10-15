// Paste your Supabase details here (Supabase dashboard -> Project Settings -> API Keys).
// The publishable / anon key is safe to put in a public GitHub repo: your data is
// protected by the security rules in schema.sql and by your login.
window.PLANT_CONFIG = {
  SUPABASE_URL: "https://rmpomshdgxkwsyytmbek.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_apeD3TriBD1SDO9YxKQAmg_8r-7fJ6d",
  
  // Turn these on ONLY after you've set up the matching Edge Function (see README):
  AI_ENABLED: false,            // Claude plant ID, care guides and "Ask Claude"  (function: plant-advisor)
  PUSH_ENABLED: false,          // morning push notification                       (function: daily-summary)
  VAPID_PUBLIC_KEY: ""          // from vapid.html (the PUBLIC key only)
};
