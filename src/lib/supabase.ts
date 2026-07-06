import { createClient } from "@supabase/supabase-js";

// Same Supabase project the rest of the Bmarchai suite (Muscle Selector,
// Exercise Manager, etc.) already uses — Atlas is a separate app/deploy,
// so it needs its own sign-in, but reads/writes the same tables and users.
//
// Hardcoded on purpose, not read from an env var: we tried VITE_SUPABASE_URL
// / VITE_SUPABASE_ANON_KEY via Cloudflare Workers' dashboard variables and
// hit two separate failure modes — (1) Workers redeploying from a committed
// config file silently ignores/overrides dashboard-set values, and (2)
// Vite needs these baked in at BUILD time, while Workers' "Variables and
// secrets" panel is generally a RUNTIME concept for the request handler, not
// the build step — so the value never actually reached the client bundle.
//
// None of that matters for secrecy here: this is the publishable/anon key,
// meant to be exposed client-side, already visible in Muscle Selector's page
// source today. Real access control lives entirely in Supabase's Row Level
// Security policies, not in hiding this string. Hardcoding it removes an
// entire class of build-pipeline configuration bugs for zero security cost.
const SUPABASE_URL = "https://yrvbbkagrombyyavuggy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cmvtnd7UDSu0hlz4pfoYyQ_U_ovzuv4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
