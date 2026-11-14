const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

const coreSrc = fs.realpathSync(path.join(__dirname, '../../packages/mobile-core/src'));
const overrides = path.join(__dirname, 'web/core');
const shimDir = path.join(__dirname, 'web/shims');

// Native-only modules the shared core imports, replaced with browser versions.
const shims = {
  'expo-secure-store': 'secure-store.ts',
  'expo-notifications': 'notifications.ts',
  'expo-file-system': 'file-system.ts',
  'expo-document-picker': 'document-picker.ts',
  'expo-image-picker': 'image-picker.ts',
  'expo-print': 'print.ts',
};

const inside = (file, dir) => file === dir || file.startsWith(dir + path.sep);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromShim = inside(context.originModulePath, shimDir);
  if (platform === 'web' && shims[moduleName] && !fromShim) {
    return { type: 'sourceFile', filePath: path.join(shimDir, shims[moduleName]) };
  }
  const resolution = context.resolveRequest(context, moduleName, platform);
  // packages/mobile-core stays a verbatim copy of the native app's core. A file at the same
  // relative path under web/core replaces it in the web bundle (an override may still wrap
  // the original by importing it).
  if (platform === 'web' && resolution.type === 'sourceFile' && path.isAbsolute(resolution.filePath)) {
    const real = fs.realpathSync(resolution.filePath);
    if (inside(real, coreSrc)) {
      const relative = path.relative(coreSrc, real).replace(/\.(web\.)?[jt]sx?$/, '');
      for (const extension of ['.tsx', '.ts']) {
        const candidate = path.join(overrides, relative + extension);
        if (candidate !== context.originModulePath && fs.existsSync(candidate)) {
          return { type: 'sourceFile', filePath: candidate };
        }
      }
    }
  }
  return resolution;
};

module.exports = withNativeWind(config, { input: './src/global.css' });
