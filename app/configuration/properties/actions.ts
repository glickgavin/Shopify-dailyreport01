'use server';
import { supabaseAdmin } from '@/lib/supabase';

export async function savePropertyDefinition(input: {
  property_key: string;
  display_name: string;
  description: string | null;
  data_type: string;
}): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('analytics_property_definitions')
    .upsert(input, { onConflict: 'property_key' });
  return { error: error?.message };
}

export async function deletePropertyDefinition(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_property_definitions').delete().eq('id', id);
  return { error: error?.message };
}
