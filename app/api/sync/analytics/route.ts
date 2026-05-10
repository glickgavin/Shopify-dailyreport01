import { NextResponse } from 'next/server';
import { runForwardSync } from '@/lib/analytics/forward-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Manual "Sync Now" — no auth required (called from the UI)
export async function POST() {
  return runForwardSync('manual');
}
