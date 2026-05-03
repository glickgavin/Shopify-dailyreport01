import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
// Requires Vercel Pro (free tier has 10s limit; Puppeteer typically takes 15-30s)
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { date: string } }) {
  const { date } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
  const url = `${appUrl}/dashboard/${date}`;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    // Wait for charts to render
    await new Promise((r) => setTimeout(r, 1500));
    const buffer = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true });
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `inline; filename="dashboard-${date}.jpg"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } finally {
    await browser.close();
  }
}
