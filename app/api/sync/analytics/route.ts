import { NextResponse } from 'next/server';
import { runForwardSync } from '@/app/api/cron/analytics-sync/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Manual "Sync Now" — no auth required (called from the UI)
export async function POST() {
  return runForwardSync('manual');
}
