import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { runPipelineWithErrorHandling } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const dateParam = req.nextUrl.searchParams.get('date');
  const targetDate = dateParam ?? format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
  const silent = req.nextUrl.searchParams.get('silent') === 'true';

  try {
    const result = await runPipelineWithErrorHandling(targetDate, { silent });
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, date: targetDate }, { status: 500 });
  }
}
