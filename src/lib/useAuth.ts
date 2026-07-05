import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Atlas is a separate app/deploy from Muscle Selector, so sessions aren't
// shared automatically (supabase-js persists to localStorage, scoped per
// origin) — this gives Atlas its own lightweight sign-in against the same
// Supabase project/users, same pattern as Muscle Selector's auth modal.
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, ready };
}
