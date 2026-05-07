'use server';
import { supabaseAdmin } from '@/lib/supabase';
import type { Predicate } from '@/lib/analytics/predicates';

export async function saveBehavior({
  id, name, predicates,
}: { id?: number; name: string; predicates: Predicate[] }): Promise<{ error?: string }> {
  const payload = predicates as unknown as import('@/lib/types/database').Json;
  if (id) {
    const { error } = await supabaseAdmin
      .from('analytics_behaviors')
      .update({ name, predicates: payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { error: error?.message };
  } else {
    const { error } = await supabaseAdmin
      .from('analytics_behaviors')
      .insert({ name, predicates: payload });
    return { error: error?.message };
  }
}

export async function deleteBehavior(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_behaviors').delete().eq('id', id);
  return { error: error?.message };
}
