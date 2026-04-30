import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Read-only client for client-side / public data
export const supabase = createClient<Database>(url, anonKey);

// Full-access client for server-side writes — never expose to browser
export const supabaseAdmin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false },
});
