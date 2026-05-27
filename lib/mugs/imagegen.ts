import { createClient } from '@supabase/supabase-js';

// Read-only client for the imagegen project — fetches tile image paths only.
// Credentials are separate from the main Supabase project.
function getImagegenClient() {
  const url = process.env.IMAGEGEN_SUPABASE_URL;
  const key = process.env.IMAGEGEN_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('IMAGEGEN_SUPABASE_URL or IMAGEGEN_SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface TileImage {
  url:    string;  // public fetch URL
  format: string;  // 'png' | 'jpg' | etc.
  width:  number | null;
  height: number | null;
}

export async function resolveTileImage(tileId: string): Promise<TileImage> {
  const client = getImagegenClient();

  const { data, error } = await client
    .from('images')
    .select('image_path, format, width, height')
    .eq('id', tileId)
    .single();

  const baseUrl = process.env.IMAGEGEN_SUPABASE_URL!.replace(/\/$/, '');

  if (error || !data) {
    // Fall back to tiles-uploads bucket (direct customer uploads)
    const fallbackUrl = `${baseUrl}/storage/v1/object/public/tiles-uploads/order-uploads/${tileId}`;
    return { url: fallbackUrl, format: 'jpg', width: null, height: null };
  }

  const url = `${baseUrl}/storage/v1/object/public/images/${data.image_path}`;

  return {
    url,
    format: (data.format as string) ?? 'png',
    width:  data.width  as number | null,
    height: data.height as number | null,
  };
}
