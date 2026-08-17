import { NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { retryFailedAllocations } from '@/lib/stripe-credit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Admin "Retry failed allocations" button. Unlike the hourly cron it also
// rescues rows stuck in 'processing' (crashed mid-flight).

export async function POST() {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await retryFailedAllocations({ limit: 10, maxRetries: 5, includeStaleProcessing: true });
  return NextResponse.json(summary);
}
