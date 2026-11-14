const plugin = require('tailwindcss/plugin');
const { colors, fonts, type } = require('./src/theme.json');

const size = ({ size, lineHeight }) => [`${size}px`, { lineHeight: `${lineHeight}px` }];

/** @type {import('tailwindcss').Config} */
module.exports = (appRoot) => ({
  content: [require('path').join(appRoot, 'src/**/*.{js,jsx,ts,tsx}'), require('path').join(__dirname, 'src/**/*.{js,jsx,ts,tsx}')],
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  corePlugins: {
    fontWeight: false,
  },
  theme: {
    // Replaces Tailwind's scale so every screen stays on the theme.json set; xl and 4xl+ are intentionally absent.
    fontSize: {
      '2xs': size(type.eyebrow),
      xs: size(type.small),
      sm: size(type.caption),
      base: size(type.body),
      lg: size(type.button),
      brand: size(type.brand),
      '2xl': size(type.title),
      '3xl': size(type.display),
    },
    extend: {
      letterSpacing: {
        eyebrow: `${type.eyebrow.letterSpacing}px`,
      },
      colors: {
        cobalt: colors.cobalt,
        'deep-blue': colors.deepBlue,
        aqua: colors.aqua,
        'fresh-green': colors.freshGreen,
        lime: colors.lime,
        coral: colors.coral,
        sun: colors.sun,
        cloud: colors.cloud,
        ice: colors.ice,
        ink: colors.ink,
        slate: colors.slate,
        line: colors.line,
        mist: colors.mist,
      },
      fontFamily: {
        sans: [fonts.regular],
        hand: [fonts.hand],
        serif: [fonts.serif],
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        '.font-thin': { fontFamily: fonts.regular, fontWeight: '400' },
        '.font-extralight': { fontFamily: fonts.regular, fontWeight: '400' },
        '.font-light': { fontFamily: fonts.regular, fontWeight: '400' },
        '.font-normal': { fontFamily: fonts.regular, fontWeight: '400' },
        '.font-medium': { fontFamily: fonts.regular, fontWeight: '400' },
        '.font-semibold': { fontFamily: fonts.medium, fontWeight: '400' },
        '.font-bold': { fontFamily: fonts.semibold, fontWeight: '400' },
        '.font-extrabold': { fontFamily: fonts.semibold, fontWeight: '400' },
        '.font-black': { fontFamily: fonts.semibold, fontWeight: '400' },
        '.font-serif': { fontFamily: fonts.serif, fontWeight: '400' },
        '.font-serif-italic': { fontFamily: fonts.serifItalic, fontWeight: '400' },
        '.font-hand': { fontFamily: fonts.hand, fontWeight: '400' },
        '.font-hand-medium': { fontFamily: fonts.handMedium, fontWeight: '400' },
      });
    }),
  ],
});
