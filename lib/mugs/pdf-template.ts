import { PDFDocument, PDFImage } from 'pdf-lib';
import { resolveTileImage } from './imagegen';

// Mug print spec:
//   Trim area:  200 × 96 mm
//   Bleed:      2 mm top + bottom → document size 200 × 100 mm
//   Colour:     sRGB, 300 DPI
//
// Layout — two equal panels side-by-side:
//   Left  (x=0 … 100mm):  static branded image (MUG_STATIC_IMAGE_URL)
//   Right (x=100mm … 200mm): customer AI portrait (from imagegen)
//
// Resolution note: source tiles are currently 512×512 px ≈ 130 DPI at 100 mm.
// Gelato recommends ≥ 300 DPI. Upscaling is handled by pdf-lib's image scaling;
// print quality will improve once the imagegen pipeline produces higher-res tiles.

const MM_TO_PT = 72 / 25.4;
const DOC_W_PT = 200 * MM_TO_PT;  // 566.93 pt
const DOC_H_PT = 100 * MM_TO_PT;  // 283.46 pt

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function embedAuto(doc: PDFDocument, bytes: ArrayBuffer, format: string): Promise<PDFImage> {
  const fmt = format.toLowerCase();
  if (fmt === 'jpg' || fmt === 'jpeg') return doc.embedJpg(bytes);
  return doc.embedPng(bytes);  // default to PNG for everything else
}

function staticImageFormat(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  return 'png';
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
    embedAuto(doc, staticBytes, staticImageFormat(staticUrl)),
    embedAuto(doc, tileBytes,   tile.format),
  ]);

  // Left panel: static branded image
  page.drawImage(staticImg, { x: 0,       y: 0, width: panelW, height: DOC_H_PT });

  // Right panel: customer AI portrait
  page.drawImage(tileImg,   { x: panelW,  y: 0, width: panelW, height: DOC_H_PT });

  return Buffer.from(await doc.save());
}
