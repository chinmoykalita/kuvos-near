import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const forbidden = /(?:@solana(?:-mobile)?\/|@privy-io\/|@ethersproject\/|(?:^|\/)apps\/solana-mobile(?:\/|$)|(?:^|\/)plugins\/siwe(?:\/|$)|(?:^|\/)receipt-wallet(?:\.|$)|(?:^|\/)native-wallet(?:\.|$)|(?:^|\/)rewards-api(?:\.|$))/;
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
for (const directory of ['apps/mobile', 'packages/mobile-core']) {
  const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert(!forbidden.test(name), `${directory} depends on ${name}`);
    assert(name !== '@kuvos/solana-mobile', 'The standard app must not depend on the Solana app.');
  }
  for (const file of files(resolve(root, directory, 'src')).filter((path) => /\.[jt]sx?$/.test(path))) {
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteralLike(node)) {
        const value = node.text.replaceAll('\\', '/');
        assert(!forbidden.test(value), `${file} references ${value}`);
        assert(!value.startsWith('/solana/'), `${file} calls a Solana API`);
        if (directory === 'packages/mobile-core' && value.startsWith('.')) {
          assert(!resolve(dirname(file), value).startsWith(resolve(root, 'apps') + '/'), `${file} imports an app`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
// Check the actual Metro module graph when an export source map is supplied.
for (const mapFile of process.argv.slice(2)) {
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  assert(Array.isArray(map.sources) || Array.isArray(map.sections), `${mapFile} is not a source map`);
  function checkMap(value) {
    for (const source of value.sources ?? []) assert(!forbidden.test(source), `${mapFile} bundles ${source}`);
    for (const section of value.sections ?? []) checkMap(section.map);
  }
  checkMap(map);
}
console.log('Standard app and shared core contain no Solana imports, dependencies, or API calls.');
