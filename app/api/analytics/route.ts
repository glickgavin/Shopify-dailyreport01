import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const API_URL = process.env.ANALYTICS_API_URL!;
const API_KEY = process.env.ANALYTICS_API_KEY!;

const QuerySchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(1000),
  offset: z.coerce.number().int().min(0).optional().default(0),
  event_type: z.string().optional(),
  page_path: z.string().optional(),
  device_type: z.string().optional(),
  is_preview: z.coerce.boolean().optional(),
  session_id: z.string().optional(),
  visitor_id: z.string().optional(),
  // scan mode: return distinct event types only
  scan: z.coerce.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(sp);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const params = parsed.data;
  const upstream = new URL(API_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) upstream.searchParams.set(k, String(v));
  }

  const res = await fetch(upstream.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
