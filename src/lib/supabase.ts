import { createClient } from "@supabase/supabase-js";

// Same Supabase project the rest of the Bmarchai suite (Muscle Selector,
// Exercise Manager, etc.) already uses — Atlas is a separate app/deploy,
// so it needs its own sign-in, but reads/writes the same tables and users.
//
// These are read from Vite's public env vars (see .env.example) rather than
// hardcoded, per config.server.ts's guidance — but they are NOT secrets:
// the anon/publishable key is meant to be exposed client-side and is
// already visible in Muscle Selector's page source. Access control lives
// entirely in Supabase's Row Level Security policies, not in hiding this key.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Atlas] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill them in.",
  );
}

export const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "");
