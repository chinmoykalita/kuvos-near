import assert from 'node:assert/strict';

import { scanPagesHtml } from './scan-pages.ts';

const html = scanPagesHtml([
  { mimeType: 'image/jpeg', base64: 'first' },
  { mimeType: 'image/png', base64: 'second' },
]);
assert.equal((html.match(/class="page"/g) ?? []).length, 2);
assert.ok(html.indexOf('image/jpeg;base64,first') < html.indexOf('image/png;base64,second'));
assert.match(html, /page-break-after: auto/);
