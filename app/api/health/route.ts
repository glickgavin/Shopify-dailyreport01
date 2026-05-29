export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { SYSTEMS } from '@/lib/systems';

interface HealthResult {
  id: string;
  status: 'operational' | 'degraded';
  httpStatus: number | null;
  checkedAt: string;
}

async function pingSystem(url: string): Promise<{ status: 'operational' | 'degraded'; httpStatus: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
    }
    clearTimeout(timer);
    const operational = res.status >= 200 && res.status < 400;
    return { status: operational ? 'operational' : 'degraded', httpStatus: res.status };
  } catch {
    clearTimeout(timer);
    return { status: 'degraded', httpStatus: null };
  }
}

export async function GET() {
  const results = await Promise.all(
    SYSTEMS.map(async (sys): Promise<HealthResult> => {
      const checkedAt = new Date().toISOString();
      if (sys.status === 'building') {
        return { id: sys.id, status: 'degraded', httpStatus: null, checkedAt };
      }
      const target = sys.healthUrl ?? sys.url;
      const { status, httpStatus } = await pingSystem(target);
      return { id: sys.id, status, httpStatus, checkedAt };
    })
  );

  return NextResponse.json(
    { results },
    {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
      },
    }
  );
}
