import { registerBlob } from './file-system';

// Browser stand-in for expo-print's printToFileAsync, used only to join scanned photos
// into one PDF. It reads the data-URI images from the core's scan-pages HTML and writes
// one 612x792 page per image, letterboxed like the native `object-fit: contain` page.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

async function toJpeg(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the scanned pages.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not prepare the scanned pages.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

export async function printToFileAsync({ html }: { html: string; width?: number; height?: number }) {
  const sources = [...html.matchAll(/<img src="(data:[^"]+)"/g)].map((match) => match[1]);
  const pages = [];
  for (const source of sources) pages.push(await toJpeg(source));

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | (string | Uint8Array)[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const piece of Array.isArray(body) ? body : [body]) push(piece);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const pageIds = pages.map((_, index) => 3 + index * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const scale = Math.min(PAGE_WIDTH / page.width, PAGE_HEIGHT / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    const x = (PAGE_WIDTH - width) / 2;
    const y = (PAGE_HEIGHT - height) / 2;
    const content = `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    object(pageId + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(pageId + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      page.bytes,
      '\nendstream',
    ]);
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const uri = await registerBlob(new Blob(parts as BlobPart[], { type: 'application/pdf' }));
  return { uri, numberOfPages: pages.length };
}

export async function printAsync() {
  window.print();
}
