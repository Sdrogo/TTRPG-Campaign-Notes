import { useEffect, useState } from 'react';
import { type AuthSession, getSession, onSessionChange } from '../lib/auth';
import { DEMO_SESSION, isDemoMode } from '../lib/demo/demoMode';

/**
 * The current session, kept in sync with sign-in, renewal and sign-out
 * (`lib/auth`). `loading` is true until the backend has said whether this
 * browser is signed in. While the Demo is on (spec 45_2) it is the sample
 * Room's Master instead; a real session stays signed in underneath.
 */
export function useSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSessionChange((newSession) => {
      if (active) setSession(newSession);
    });
    void getSession().then((restored) => {
      if (!active) return;
      setSession(restored);
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (isDemoMode()) return { session: DEMO_SESSION, loading: false };
  return { session, loading };
}
