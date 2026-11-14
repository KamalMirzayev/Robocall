/** @type {import('tailwindcss').Config} */

// Arzoom design system. The pages were written for a dark slate/blue theme, so
// instead of rewriting every className the Tailwind palettes are pointed at
// Arzoom's tokens (globals.css), which switch between light and dark.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const neutral = {
  50: v('ink'), 100: v('ink'), 200: v('ink-2'), 300: v('ink-2'),
  400: v('muted'), 500: v('muted'), 600: v('line-2'), 700: v('field'),
  800: v('surface'), 900: v('bg'), 950: v('bg'),
};
const tone = (name) => ({
  50: v(`${name}-soft`), 100: v(name), 200: v(name), 300: v(name), 400: v(name),
  500: v(`${name}-solid`), 600: v(`${name}-solid`), 700: v(`${name}-strong`),
  800: v(`${name}-strong`), 900: v(`${name}-soft`), 950: v(`${name}-soft`),
});

module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        white: v('ink'),
        slate: neutral,
        gray: neutral,
        blue: tone('blue'),
        sky: tone('blue'),
        indigo: tone('blue'),
        red: tone('red'),
        rose: tone('red'),
        green: tone('ok'),
        emerald: tone('ok'),
        amber: tone('warn'),
        yellow: tone('warn'),
        orange: tone('warn'),
        purple: tone('violet'),
        violet: tone('violet'),
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Archivo', 'Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
