import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Renders /dashboard/man-accounts headlessly and prints it to PDF
// (same pattern as /api/export/range/pdf). Landscape A4 — the table is wide.

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const view = searchParams.get('view') ?? 'month';
  const today = searchParams.get('today');

  const pageUrl = new URL(`${origin}/dashboard/man-accounts`);
  if (view !== 'month') pageUrl.searchParams.set('view', view);
  if (today) pageUrl.searchParams.set('today', today);

  const filename = `man-accounts-${view}.pdf`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1680, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.goto(pageUrl.toString(), { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    const buffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      scale: 0.72,
      margin: { top: '0.4in', right: '0.35in', bottom: '0.4in', left: '0.35in' },
    });
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser.close();
  }
}
