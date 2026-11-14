const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(root, 'apps/mobile/package.json'));
const babel = appRequire('@babel/core');
const element = (type, props) => ({ type, props });

function render(file, component, states, removeWorkaround = false) {
  const filename = path.join(root, 'packages/mobile-core/src/screens', file);
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = babel.transformSync(
    removeWorkaround ? source.replace(/['"]use no memo['"];[^\n]*/, '') : source,
    {
      filename,
      configFile: path.join(root, 'apps/mobile/babel.config.js'),
      envName: 'production',
      caller: {
        name: 'metro', platform: 'ios', isDev: false,
        supportsReactCompiler: true, supportsStaticESM: false,
      },
    },
  );
  const exports = {};
  let stateIndex = 0;
  function requireMock(name) {
    if (name.startsWith('@babel/runtime/')) return appRequire(name);
    if (name === 'react') return {
      useState: () => [states[stateIndex++], () => {}],
      useRef: () => ({ current: null }),
      useCallback: (callback) => callback,
      useEffect: () => {},
    };
    if (name === 'react/compiler-runtime') return {
      c: (size) => Array(size).fill(Symbol.for('react.memo_cache_sentinel')),
    };
    if (name.includes('jsx-runtime')) return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'expo-router') return { useRouter: () => ({}), useFocusEffect: () => {} };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === '../care-session') return { useCareSession: () => ({ membership: { role: 'PATIENT', patient: { id: 'synthetic-patient' } } }) };
    if (name === '../app-extensions') return { useAppExtensions: () => ({}) };
    return new Proxy({}, { get: (_, key) => key });
  }
  vm.runInNewContext(code, { exports, require: requireMock });
  return exports[component]({ planId: 'synthetic-plan' });
}

// Compile with the same production optimizer that caused the TestFlight failure.
const cases = [
  ['today-screen.tsx', 'TodayScreen', [undefined, '', undefined]],
  ['plan-detail-screen.tsx', 'PlanDetailScreen', ['', { id: 'synthetic-plan', name: 'Test plan', status: 'active' }, undefined, '', false, '', '']],
];
for (const [file, component, states] of cases) {
  assert.doesNotThrow(() => render(file, component, states), `${component} must render before Today data arrives`);
  // Keep the reproducer: this distinguishes compiler failure from an API/data failure.
  // It depends on the component's shape, so a change that stops reproducing it is a notice, not a failure.
  if (component === 'TodayScreen') {
    try {
      render(file, component, states, true);
      console.log('Note: Today no longer reproduces the optimizer regression without "use no memo"; the workaround may be removable.');
    } catch (error) {
      assert.match(error.message, /occurrences/, 'Today failed without the workaround for an unexpected reason');
    }
  }
}
console.log('Production loading checks passed for Today and plan details.');
