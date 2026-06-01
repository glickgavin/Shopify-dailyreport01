import { NextRequest, NextResponse } from 'next/server';
import { subDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { upsertMembershipBillingEvents } from '@/lib/persistence';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  if (!secret || (auth !== `Bearer ${secret}` && querySecret !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const daysParam = req.nextUrl.searchParams.get('days');
  const singleDate = req.nextUrl.searchParams.get('date');

  // Build list of dates to process
  const dates: string[] = [];
  if (singleDate) {
    dates.push(singleDate);
  } else {
    const days = Math.min(parseInt(daysParam ?? '30', 10), 90);
    for (let i = days; i >= 1; i--) {
      dates.push(
        format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz }),
      );
    }
  }

  const perDate: Record<string, { membership_rows: number; intro: number; recurring: number } | { error: string }> = {};
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

      perDate[date] = { membership_rows: count, intro, recurring };
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

  // Update sync state cursor to the latest charged_at seen
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
    summary: { dates_processed: dates.length, total_rows: totalRows, intro: totalIntro, recurring: totalRecurring },
    per_date: perDate,
  });
}
