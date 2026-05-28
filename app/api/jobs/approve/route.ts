import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Require logged-in admin session
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { job_id?: string; approval?: string };
  const { job_id, approval } = body;

  if (!job_id) {
    return NextResponse.json({ error: 'job_id required' }, { status: 400 });
  }

  const validApprovals = ['pdf_only', 'submit', 'go_live', 'cancelled'];
  if (!approval || !validApprovals.includes(approval)) {
    return NextResponse.json({ error: `approval must be one of: ${validApprovals.join(', ')}` }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: approval, updated_at: new Date().toISOString() })
    .eq('id', job_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log the approval action
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id,
    event_type: 'admin_approval',
    payload: { approval, admin: user.email },
  });

  return NextResponse.json({ ok: true, job_id, approval });
}
