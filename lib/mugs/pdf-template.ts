import { PDFDocument, PDFImage } from 'pdf-lib';
import { resolveTileImage } from './imagegen';

// Mug print spec (Gelato 11oz ceramic):
//   Trim area:  200 × 96 mm
//   Bleed:      2 mm on all sides → document size 204 × 100 mm
//   Colour:     sRGB, 300 DPI
//
// Layout — two equal panels side-by-side (each 102mm including bleed):
//   Left  (x=0 … 102mm):  static branded image (MUG_STATIC_IMAGE_URL)
//   Right (x=102mm … 204mm): customer AI portrait (from imagegen)
//
// Resolution note: source tiles are currently 512×512 px ≈ 130 DPI at 102 mm.
// Gelato recommends ≥ 300 DPI. Upscaling is handled by pdf-lib's image scaling;
// print quality will improve once the imagegen pipeline produces higher-res tiles.

const MM_TO_PT = 72 / 25.4;
const DOC_W_PT = 204 * MM_TO_PT;  // 578.27 pt — 200mm trim + 2mm bleed each side
const DOC_H_PT = 100 * MM_TO_PT;  // 283.46 pt — 96mm trim + 2mm bleed top+bottom

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 8) throw new Error(`Fetched empty/truncated response from ${url}`);
  return bytes;
}

// Detect image format from magic bytes rather than trusting file extension or DB format field.
// PNG: 89 50 4E 47 | JPEG: FF D8 FF
async function embedAuto(doc: PDFDocument, bytes: ArrayBuffer): Promise<PDFImage> {
  const h = new Uint8Array(bytes, 0, 4);
  if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return doc.embedJpg(bytes);
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return doc.embedPng(bytes);
  throw new Error(`Unrecognised image format (magic bytes: ${Array.from(h).map(b => b.toString(16).padStart(2,'0')).join(' ')})`);
}

export async function buildMugPrintPdf(tileId: string): Promise<Buffer> {
  const staticUrl = process.env.MUG_STATIC_IMAGE_URL;
  if (!staticUrl) throw new Error('MUG_STATIC_IMAGE_URL not configured');

  // Resolve tile from imagegen project
  const tile = await resolveTileImage(tileId);

  // Fetch both images in parallel
  const [staticBytes, tileBytes] = await Promise.all([
    fetchBytes(staticUrl),
    fetchBytes(tile.url),
  ]);

  const doc = await PDFDocument.create();
  const page = doc.addPage([DOC_W_PT, DOC_H_PT]);

  const panelW = DOC_W_PT / 2;  // 283.46 pt = 100 mm

  const [staticImg, tileImg] = await Promise.all([
    embedAuto(doc, staticBytes),
    embedAuto(doc, tileBytes),
  ]);

  // Left panel: static branded image
  page.drawImage(staticImg, { x: 0,       y: 0, width: panelW, height: DOC_H_PT });

  // Right panel: customer AI portrait
  page.drawImage(tileImg,   { x: panelW,  y: 0, width: panelW, height: DOC_H_PT });

  return Buffer.from(await doc.save());
}
