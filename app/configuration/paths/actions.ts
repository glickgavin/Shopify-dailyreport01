'use server';
import { supabaseAdmin } from '@/lib/supabase';

export async function savePathDefinition(input: {
  path_pattern: string;
  canonical_name: string;
  description: string | null;
}): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('analytics_path_definitions')
    .upsert(input, { onConflict: 'path_pattern' });
  return { error: error?.message };
}

export async function deletePathDefinition(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_path_definitions').delete().eq('id', id);
  return { error: error?.message };
}
