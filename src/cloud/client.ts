/**
 * Supabase connection.
 *
 * Online mode is switched on by two build settings, VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY. Without them the app runs exactly as before, every
 * record on this device only. The anon key is meant to be public: what a
 * person may read or write is decided by the row level security rules in
 * supabase/schema.sql, not by keeping this key secret.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const cloudEnabled = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Online mode is not set up.');
  if (!client) {
    client = createClient(URL!, KEY!, {
      // PKCE puts the sign-in code in ?code=, which leaves the app's #/ routes alone.
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'agri.cloud.auth', flowType: 'pkce', detectSessionInUrl: true },
    });
  }
  return client;
}
