'use server';
import { supabaseAdmin } from '@/lib/supabase';

interface EventDefInput {
  event_type: string;
  display_name: string;
  description: string | null;
  category_id: number | null;
  is_conversion: boolean;
  is_purchase: boolean;
  revenue_property: string | null;
}

export async function saveEventDefinition(input: EventDefInput): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('analytics_event_definitions')
    .upsert({ ...input }, { onConflict: 'event_type' });
  return { error: error?.message };
}

export async function deleteEventDefinition(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_event_definitions').delete().eq('id', id);
  return { error: error?.message };
}

export async function saveCategory(name: string, color?: string, icon?: string): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('analytics_event_categories')
    .upsert({ name, color: color ?? null, icon: icon ?? null }, { onConflict: 'name' });
  return { error: error?.message };
}
