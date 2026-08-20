import { NextRequest, NextResponse } from 'next/server';
import { runSyncStep } from '@/lib/product-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Advances the product-cleanup sync state machine one step per invocation
// (every 10 min): products bulk export → ingest → orders bulk export →
// ingest → flag sold + build batches. Read-only against Shopify; never
// deletes anything.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  try {
    const result = await runSyncStep();
    console.log(`[product-cleanup-sync] ${result.phase}: ${result.detail}`);
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    console.error(`[product-cleanup-sync] ${(err as Error).message}`);
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
