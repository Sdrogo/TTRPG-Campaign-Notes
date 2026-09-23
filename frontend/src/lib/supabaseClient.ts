import { createClient } from '@supabase/supabase-js';

/**
 * The Supabase client, used for sign-in and the session only. All data goes
 * through the backend (`apiFetch`), never straight to Postgres or Storage.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
