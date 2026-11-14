export function scanPagesHtml(images: { mimeType: string; base64: string }[]) {
  return `<!DOCTYPE html><html><head><style>
    @page { size: 612px 792px; margin: 0; }
    body { margin: 0; }
    .page { width: 612px; height: 792px; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
  </style></head><body>${images
    .map(({ mimeType, base64 }) => `<div class="page"><img src="data:${mimeType};base64,${base64}"></div>`)
    .join('')}</body></html>`;
}
