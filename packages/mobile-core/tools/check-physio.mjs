import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const read = name => readFileSync(new URL('../src/physio/' + name, import.meta.url), 'utf8');
const library = JSON.parse(read('library.json'));
const renderer = JSON.parse(read('renderer.json'));
function loadTs(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { exports, require: createRequire(new URL('../src/physio/' + name, import.meta.url)) });
  return exports;
}
const { findExercises } = loadTs('catalogue.ts');
assert.equal(findExercises('', '').length, library.exercises.length);
assert(findExercises('QUAD sets', '').some(e => e.id === 'knee-quad-set'));
assert(findExercises('  heel   slide ', 'knee').some(e => e.id === 'knee-heel-slide'));
assert.equal(findExercises('unfindable exercise', '').length, 0);
for (const c of library.categories) {
  assert.equal(findExercises('', c.id).length, library.exercises.filter(e => e.categories.includes(c.id)).length);
}

// A minimal SVG attribute sink exercises the original rig at every keyframe and midpoint.
let attributes = 0;
function element() {
  return {
    innerHTML: '', isConnected: true,
    querySelector(selector) {
      const className = selector.slice(1);
      const present = [...this.innerHTML.matchAll(/class="([^"]+)"/g)].some(m => m[1].split(' ').includes(className));
      return present ? { setAttribute(key, value) {
        assert(!/NaN|Infinity|undefined/.test(String(value)), `${className}.${key}: ${value}`);
        attributes++;
      } } : null;
    },
  };
}
const context = { document: { createElement: element }, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }) };
context.window = context;
vm.runInNewContext(renderer.script, context);
for (const ex of library.exercises) {
  const node = element();
  let frame;
  const player = context.KuvosPhysio.mount(node, ex, { paused: true, onFrame: value => { frame = value; } });
  assert.equal(player.playing, false);
  assert(node.innerHTML.includes('<svg'), ex.id);
  for (let i = 0; i < ex.animation.frames.length; i++) {
    player.t = ex.animation.frames[i].t;
    player.draw();
    assert(Number.isFinite(frame.progress), ex.id);
    assert(typeof frame.cue === 'string', ex.id);
    if (i) {
      player.t = (ex.animation.frames[i].t + ex.animation.frames[i - 1].t) / 2;
      player.draw();
    }
  }
  player.play(); assert.equal(player.playing, true);
  player.pause(); assert.equal(player.playing, false);
  player.setSpeed(0.5); assert.equal(player.speed, 0.5);
  player.restart(); assert.equal(player.t, 0);
}
assert(attributes > 1000);
assert.equal(context.KuvosPhysio.resolvePlan, undefined);
const { playerHtml } = loadTs('player-html.ts');
const hostile = { ...library.exercises[0], name: '</script><script>alert(1)</script>' };
const html = playerHtml(hostile);
assert(!html.includes(hostile.name));
assert(html.includes("default-src 'none'"));
assert(html.includes('paused: true'));
assert(!html.includes('fonts.googleapis.com'));
console.log(`Checked ${library.exercises.length} exercise rigs, ${attributes} SVG updates, playback, search, category filters and HTML isolation.`);

// Exercise the embedded controls used on native focus/load and app backgrounding.
const listeners = {};
let reducedMotion = false;
const stage = element();
const playback = {
  document: {
    createElement: element,
    getElementById: () => stage,
    addEventListener: (name, listener) => { listeners[name] = listener; },
    hidden: false,
  },
  requestAnimationFrame() {},
  matchMedia: () => ({ matches: reducedMotion }),
};
playback.window = playback;
for (const script of playerHtml(library.exercises[0]).matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  vm.runInNewContext(script[1], playback);
}
playback.physioControl('play');
assert.equal(playback.player.playing, true);
playback.physioControl('slow');
assert.equal(playback.player.speed, 0.5);
playback.player.t = library.exercises[0].animation.duration_sec * 100 + 0.5;
playback.player.draw();
assert.equal(playback.player.playing, true, 'Playback must keep looping');
playback.physioControl('normal');
assert.equal(playback.player.speed, 1);
playback.document.hidden = true;
listeners.visibilitychange();
assert.equal(playback.player.playing, false);
playback.physioControl('play');
assert.equal(playback.player.playing, true);
playback.physioControl('pause');
reducedMotion = true;
playback.physioControl('play');
assert.equal(playback.player.playing, false, 'Respect reduced motion');
console.log('Checked infinite looping, speed changes, pause/resume and reduced motion.');

// Loading the screen on an older binary must never evaluate WebView's getEnforcing import.
const componentSource = readFileSync(new URL('../src/components/physio-player.tsx', import.meta.url), 'utf8');
const componentJs = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
for (const installed of [false, true]) {
  let webViewImports = 0;
  vm.runInNewContext(componentJs, {
    exports: {},
    require(name) {
      if (name === 'react-native') return { TurboModuleRegistry: { get: () => installed ? {} : null } };
      if (name === 'react-native-webview') {
        webViewImports++;
        assert(installed, 'Must not load WebView on an incompatible binary');
        return { WebView: () => null };
      }
      return {};
    },
  });
  assert.equal(webViewImports, installed ? 1 : 0);
}
console.log('Checked safe screen imports with and without the native WebView module.');

const { suggestedExercises } = loadTs('catalogue.ts');
assert(suggestedExercises('Heel slides twice daily').exercises.some(e => e.id === 'knee-heel-slide'));
assert.equal(suggestedExercises('unrelated words').exercises.length, 0);
const targeted = suggestedExercises('knee strength').exercises;
assert(targeted.length > 0);
assert(targeted.every(e => e.categories.includes('knee') && e.tags.includes('strength')));
console.log('Checked name and target-based suggestions.');
