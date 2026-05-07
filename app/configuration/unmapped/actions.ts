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

export async function bulkSaveEventDefinitions(items: EventDefInput[]): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('analytics_event_definitions')
    .upsert(items, { onConflict: 'event_type' });
  return { error: error?.message };
}
