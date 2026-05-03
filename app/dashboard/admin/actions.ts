'use server';

import { runPipeline } from '@/lib/pipeline';

export async function rerunPipeline(
  date: string,
  options: { silent?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: 'Invalid date format' };
  }

  try {
    const result = await runPipeline(date, {
      silent: options.silent ?? false,
      jobType: options.silent ? 'backfill' : 'manual_run',
    });
    return {
      ok: true,
      message: `Done — revenue ${result.summary.revenue}, orders ${result.summary.orders}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Pipeline error' };
  }
}
