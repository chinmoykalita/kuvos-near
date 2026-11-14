import renderer from './renderer.json';
import type { Exercise } from './catalogue';

// Escape script delimiters even though the catalogue is bundled, not remote input.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function playerHtml(exercise: Exercise) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>${renderer.css}
html,body{height:100%;margin:0;background:#F3F8FC;overflow:hidden}#stage{height:100%;display:flex;align-items:center;justify-content:center}svg{width:100%;height:100%}</style></head>
<body><div id="stage" role="img" aria-label="Exercise movement demonstration"></div>
<script>${renderer.script}</script><script>
var player = KuvosPhysio.mount(document.getElementById('stage'), ${scriptJson(exercise)}, { paused: true });
window.physioControl = function(action) {
  if(action === 'play' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) player.play();
  if(action === 'pause') player.pause();
  if(action === 'restart') { player.restart(); player.draw(); }
  if(action === 'slow') player.setSpeed(0.5);
  if(action === 'normal') player.setSpeed(1);
};
document.addEventListener('visibilitychange', function(){ if(document.hidden) player.pause(); });
</script></body></html>`;
}
