import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
// Requires Vercel Pro (free tier has 10s limit; Puppeteer typically takes 15-30s)
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { date: string } }) {
  const { date } = params;
  // Use the request's own origin so export works on any deployment (preview or production)
  const origin = req.nextUrl.origin;
  const url = `${origin}/dashboard/${date}`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1440, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="dashboard-${date}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } finally {
    await browser.close();
  }
}
