import { NextRequest, NextResponse } from 'next/server';
import { toZonedTime, format } from 'date-fns-tz';
import { computeAndSaveMembershipMetrics } from '@/lib/membership-metrics';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret      = process.env.CRON_SECRET;
  const headerAuth  = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const authorized  = secret && (headerAuth === `Bearer ${secret}` || querySecret === secret);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz        = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const dateParam = req.nextUrl.searchParams.get('date');
  const date      = dateParam ?? format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });

  try {
    const r = await computeAndSaveMembershipMetrics(date);

    console.log(
      `[membership-metrics] date=${r.metric_date}` +
      ` active=${r.active_members}` +
      ` new=${r.new_signups}` +
      ` mrr=${r.mrr_net.toFixed(2)}` +
      ` churn=${(r.avg_monthly_churn * 100).toFixed(1)}%` +
      ` conservative_ltv=${r.conservative_ltv.toFixed(2)}` +
      ` projected_ltv=${r.projected_ltv.toFixed(2)}` +
      ` one_and_done=${(r.one_and_done_rate * 100).toFixed(1)}%`,
    );

    return NextResponse.json({ status: 'ok', ...r });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[membership-metrics] error: ${msg}`);
    return NextResponse.json({ error: msg, date }, { status: 500 });
  }
}
