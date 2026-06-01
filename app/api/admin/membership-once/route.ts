import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { upsertMembershipBillingEvents } from '@/lib/persistence';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

// One-shot 90-day membership backfill. Guarded by CRON_SECRET.
// Remove this file and its vercel.json cron entry after first successful run.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const days = 90;

  const dates: string[] = [];
  for (let i = days; i >= 1; i--) {
    dates.push(
      format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz }),
    );
  }

  const perDate: Record<string, { rows: number; intro: number; recurring: number } | { error: string }> = {};
  let totalRows = 0;
  let totalIntro = 0;
  let totalRecurring = 0;
  let maxChargedAt: string | null = null;

  for (const date of dates) {
    try {
      const { membershipBillingRows } = await fetchOrdersForDate(date);
      const count = await upsertMembershipBillingEvents(membershipBillingRows);
      const intro = membershipBillingRows.filter((r) => r.is_intro).length;
      const recurring = membershipBillingRows.length - intro;

      perDate[date] = { rows: count, intro, recurring };
      totalRows += count;
      totalIntro += intro;
      totalRecurring += recurring;

      if (membershipBillingRows.length > 0) {
        const dayMax = membershipBillingRows.reduce(
          (m, r) => (r.charged_at > m ? r.charged_at : m),
          membershipBillingRows[0].charged_at,
        );
        if (!maxChargedAt || dayMax > maxChargedAt) maxChargedAt = dayMax;
      }
    } catch (e) {
      perDate[date] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (maxChargedAt) {
    await supabaseAdmin
      .from('membership_sync_state')
      .update({
        last_synced_charged_at: maxChargedAt,
        last_run_at:            new Date().toISOString(),
        last_run_status:        'success',
        last_run_rows:          totalRows,
      })
      .eq('id', 1);
  }

  return NextResponse.json({
    status: 'ok',
    summary: {
      dates_processed: dates.length,
      total_rows: totalRows,
      intro: totalIntro,
      recurring: totalRecurring,
    },
    per_date: perDate,
  });
}
