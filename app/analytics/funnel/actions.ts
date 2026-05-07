'use server';
import { supabaseAdmin } from '@/lib/supabase';

interface Step { event_type: string; label?: string }

export async function saveFunnel({
  id, name, steps,
}: { id?: number; name: string; steps: Step[] }): Promise<{ error?: string }> {
  if (id) {
    const { error } = await supabaseAdmin
      .from('analytics_funnels')
      .update({ name, steps: steps as unknown as import('@/lib/types/database').Json, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { error: error?.message };
  } else {
    const { error } = await supabaseAdmin
      .from('analytics_funnels')
      .insert({ name, steps: steps as unknown as import('@/lib/types/database').Json });
    return { error: error?.message };
  }
}

export async function deleteFunnel(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_funnels').delete().eq('id', id);
  return { error: error?.message };
}
