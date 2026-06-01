import { NextRequest, NextResponse } from 'next/server';
import { toZonedTime, format } from 'date-fns-tz';
import { runMembershipStatusSnapshot } from '@/lib/membership-status';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const headerAuth  = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const authorized  = secret && (headerAuth === `Bearer ${secret}` || querySecret === secret);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  // Default to today — snapshot reflects current membership status using all
  // billing events already in the DB (yesterday's orders written by the
  // daily pipeline cron that runs at 07:15).
  const dateParam = req.nextUrl.searchParams.get('date');
  const date = dateParam ?? format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });

  try {
    const result = await runMembershipStatusSnapshot(date);

    console.log(
      `[membership-snapshot] date=${result.snapshot_date}` +
      ` total=${result.total}` +
      ` active=${result.active}` +
      ` new=${result.new_members}` +
      ` intro_cancelled=${result.intro_cancelled}` +
      ` suspect=${result.involuntary_suspect}` +
      ` churned=${result.churned}` +
      ` billed_this_period=${result.billed_this_period}`,
    );

    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[membership-snapshot] error: ${msg}`);
    return NextResponse.json({ error: msg, date }, { status: 500 });
  }
}
