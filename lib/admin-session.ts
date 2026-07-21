import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

/**
 * Returns the currently logged-in Supabase user for admin dashboard requests,
 * or null when unauthenticated. Mirrors the cookie-based session check used by
 * the admin pages / routes so browser-facing endpoints share one guard.
 */
export async function getAdminSessionUser(): Promise<User | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a context where cookies are read-only — safe to ignore.
          }
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}
