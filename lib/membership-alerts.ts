import { supabaseAdmin } from '@/lib/supabase';
import type { Alert } from '@/lib/alerts';

export async function checkMembershipAlerts(today: {
  active_members: number;
  mrr_net: number;
  metric_date: string;
}): Promise<Alert[]> {
  const alerts: Alert[] = [];

  if (today.mrr_net === 0) {
    alerts.push({
      level: 'red',
      rule: 'membership_mrr_zero',
      message: `Membership MRR is $0 for ${today.metric_date} — likely a sync fault`,
    });
  }

  const swingPct = parseFloat(process.env.ALERT_MEM_ACTIVE_SWING_PCT ?? '30') / 100;
  const { data: prev } = await supabaseAdmin
    .from('membership_metrics_daily')
    .select('active_members, metric_date')
    .lt('metric_date', today.metric_date)
    .order('metric_date', { ascending: false })
    .limit(1)
    .single();

  if (prev && prev.active_members > 0) {
    const swing = Math.abs(today.active_members - prev.active_members) / prev.active_members;
    if (swing > swingPct) {
      const dir = today.active_members > prev.active_members ? '▲' : '▼';
      alerts.push({
        level: 'red',
        rule: 'membership_active_swing',
        message: `Active members ${dir}${(swing * 100).toFixed(1)}% day-over-day (${prev.active_members} → ${today.active_members})`,
      });
    }
  }

  return alerts;
}
