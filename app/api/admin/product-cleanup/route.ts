import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const db = supabaseAdmin as any;

// GET: config + stats + batches + recent log (+ ?q= candidate search).
// POST: config updates (kill switch etc.).

export async function GET(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();

  const count = (filters: (b: any) => any) =>
    filters(db.from('product_cleanup_candidates').select('id', { count: 'exact', head: true }))
      .then((r: any) => r.count ?? 0);

  const [config, batches, log, total, portraits, sold, eligible, queued, deleted, errors, protectedN] = await Promise.all([
    db.from('product_cleanup_config').select('*').eq('id', 1).single().then((r: any) => r.data),
    db.from('product_cleanup_batches').select('*').order('batch_number').then((r: any) => r.data ?? []),
    db.from('product_cleanup_log').select('*').order('created_at', { ascending: false }).limit(60).then((r: any) => r.data ?? []),
    count(b => b),
    count(b => b.eq('is_portrait', true)),
    count(b => b.eq('status', 'sold')),
    count(b => b.eq('status', 'candidate').eq('is_portrait', true).eq('sold', false)),
    count(b => b.eq('status', 'queued')),
    count(b => b.eq('status', 'deleted')),
    count(b => b.eq('status', 'error')),
    count(b => b.eq('status', 'protected')),
  ]);

  let search: any[] = [];
  if (q) {
    const { data } = await db.from('product_cleanup_candidates')
      .select('product_id, title, handle, shopify_created_at, status, sold, error')
      .or(`title.ilike.%${q}%,handle.ilike.%${q}%,product_id.ilike.%${q}%`)
      .order('shopify_created_at', { ascending: true })
      .limit(50);
    search = data ?? [];
  }

  return NextResponse.json({
    config,
    stats: { total, portraits, sold, eligible, queued, deleted, errors, protected: protectedN },
    batches,
    log,
    search,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.deletion_enabled === 'boolean') patch.deletion_enabled = body.deletion_enabled;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no valid fields' }, { status: 400 });

  patch.updated_at = new Date().toISOString();
  patch.updated_by = user.email ?? user.id;

  const { data, error } = await db.from('product_cleanup_config').update(patch).eq('id', 1).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
