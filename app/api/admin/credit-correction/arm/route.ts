import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Kill switch for the reversal worker. Enabling requires the literal
// confirmation string ARM; disabling needs no confirmation.

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const enable = body.enable === true;
  if (enable && body.confirm !== 'ARM') {
    return NextResponse.json({ error: 'confirmation mismatch — type ARM to enable reversals' }, { status: 400 });
  }

  const { error } = await (supabaseAdmin as any)
    .from('migration_fix_config')
    .update({ reversal_enabled: enable, updated_at: new Date().toISOString(), updated_by: user.email ?? user.id })
    .eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reversal_enabled: enable });
}
