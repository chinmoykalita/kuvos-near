import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
assert(source, 'Usage: node tools/import-physio.mjs path/to/export.html');
const html = readFileSync(source, 'utf8');
const library = JSON.parse(html.match(/var LIB=(.*);\s*\n/)?.[1] ?? 'null');
assert.equal(library?.schema, 'kuvos.physio.library/1');
const player = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0]?.[1];
assert(player?.includes('root.KuvosPhysio ='), 'Missing original animation player');
const css = html.match(/:root\{([\s\S]*?)box-sizing/)?.[1];
assert(css, 'Missing original illustration colours');
// Only copy the renderer, never the prototype's prescription parser or default-dose matching.
const renderer = player.slice(0, player.indexOf('  var STOP =')) + `
  root.KuvosPhysio = { mount: function(el, ex, o) { return new Player(el, ex, o); }, thumb: thumb };
})(typeof window !== 'undefined' ? window : this);`;
assert(player.indexOf('  var STOP =') > 0);
const ids = new Set();
const categories = new Set(library.categories.map(c => c.id));
for (const e of library.exercises) {
  assert(/^[a-z0-9-]+$/.test(e.id) && !ids.has(e.id), `Invalid/duplicate id: ${e.id}`);
  ids.add(e.id);
  assert(e.name && e.form.start && e.form.cues.length, `Missing instructions: ${e.id}`);
  assert(e.categories.every(c => categories.has(c)), `Unknown category: ${e.id}`);
  assert.equal(e.animation.type, 'rig2d_v1');
  const a = e.animation;
  assert(a.duration_sec > 0 && a.frames.length >= 2, e.id);
  assert.equal(a.frames[0].t, 0, e.id);
  assert.equal(a.frames.at(-1).t, a.duration_sec, e.id);
  a.frames.forEach((f, i) => {
    assert(f.pose.length >= 16 && f.pose.length <= 24 && f.pose.length % 2 === 0 && f.pose.every(Number.isFinite), e.id);
    assert(Number.isFinite(f.t) && (!i || f.t > a.frames[i - 1].t), e.id);
  });
  assert(!/<\s*(script|foreignObject|iframe)|\bon\w+\s*=|\b(?:href|src)\s*=|url\(\s*['"]?(?:https?:|\/\/)/i.test(a.static_svg), `Unsafe SVG: ${e.id}`);
}
const dir = fileURLToPath(new URL('../src/physio/', import.meta.url));
writeFileSync(dir + 'library.json', JSON.stringify(library, null, 2) + '\n');
writeFileSync(dir + 'renderer.json', JSON.stringify({ script: renderer, css: ':root{' + css + '}' }, null, 2) + '\n');
console.log(`Imported ${ids.size} exercises and ${categories.size} categories without changing instructions or keyframes.`);

const apiCatalogue = { version: library.version, exercises: library.exercises.map(({ id, name, form, precautions, supports }) => ({ id, name, form, precautions, supports })) };
const prettier = createRequire(new URL('../../../apps/api/package.json', import.meta.url))('prettier');
writeFileSync(new URL('../../../apps/api/src/physio-catalogue.ts', import.meta.url), await prettier.format('// Generated from the mobile library by import-physio.mjs; do not edit separately.\nexport const physioCatalogue = ' + JSON.stringify(apiCatalogue, null, 2) + ';\n', { parser: 'typescript', singleQuote: true, trailingComma: 'all' }));
