'use server';
import { supabaseAdmin } from '@/lib/supabase';

export async function savePathDefinition(input: {
  path_pattern: string;
  canonical_name: string;
  description: string | null;
}): Promise<{ error?: string }> {
  const { error, data } = await supabaseAdmin
    .from('analytics_path_definitions')
    .upsert(input, { onConflict: 'path_pattern' })
    .select('id')
    .single();
  if (error) return { error: error.message };
  if (!data) return { error: 'No row returned — upsert may have been blocked by a database policy' };
  return {};
}

export async function deletePathDefinition(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('analytics_path_definitions').delete().eq('id', id);
  return { error: error?.message };
}
