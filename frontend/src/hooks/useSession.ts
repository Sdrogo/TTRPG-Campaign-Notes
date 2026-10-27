import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { DEMO_SESSION, isDemoMode } from '../lib/demo/demoMode';

/**
 * The current Supabase session, kept in sync with sign-in and sign-out.
 * `loading` is true until the stored session has been read. While the Demo is
 * on (spec 45_2) it is the sample Room's Master instead; a real session stays
 * signed in underneath.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isDemoMode()) return { session: DEMO_SESSION, loading: false };
  return { session, loading };
}
