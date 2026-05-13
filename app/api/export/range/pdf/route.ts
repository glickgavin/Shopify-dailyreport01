import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const preset = searchParams.get('preset') ?? '7d';
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');

  const rangeUrl = new URL(`${origin}/dashboard/range`);
  rangeUrl.searchParams.set('preset', preset);
  if (from) rangeUrl.searchParams.set('from', from);
  if (to)   rangeUrl.searchParams.set('to', to);

  const filename = preset === 'custom' && from && to
    ? `range-${from}-to-${to}.pdf`
    : `range-${preset}.pdf`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1440, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.goto(rangeUrl.toString(), { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } finally {
    await browser.close();
  }
}
