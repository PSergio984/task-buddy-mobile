import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTokens } from './build-tokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Verify compiler against real tokens.json
const realTokensPath = path.resolve(__dirname, 'tokens.json');
assert.ok(fs.existsSync(realTokensPath), 'tokens.json must exist');
const realTokens = JSON.parse(fs.readFileSync(realTokensPath, 'utf8'));

const { cssOutput, tsMobileOutput } = compileTokens(realTokens);

// CSS assertion checks
assert.ok(cssOutput.includes('color-scheme: light;'), 'CSS root must declare color-scheme: light');
assert.ok(cssOutput.includes('--bg: #FFFFFF;'), 'CSS root must define light --bg');
assert.ok(
  cssOutput.includes('--coral-accent: #C43A17;'),
  'CSS root must define light --coral-accent',
);
assert.ok(
  cssOutput.includes('color-scheme: dark;'),
  'CSS dark theme must declare color-scheme: dark',
);
assert.ok(cssOutput.includes('--bg: #0C0C0F;'), 'CSS dark selector must define dark --bg');
assert.ok(
  cssOutput.includes('--coral-accent: #FF5A36;'),
  'CSS dark selector must define dark --coral-accent',
);
assert.ok(
  cssOutput.includes('body[data-theme="dark"]'),
  'CSS must support data-theme dark selector',
);
assert.ok(
  cssOutput.includes(realTokens.textures.halftoneDark),
  'CSS must include dark halftone texture',
);
assert.ok(
  cssOutput.includes(realTokens.textures.halftoneLight),
  'CSS must include light halftone texture',
);

// Mobile TS assertion checks
assert.ok(
  tsMobileOutput.includes("background: '#0C0C0F'"),
  'Mobile TS must export dark background',
);
assert.ok(tsMobileOutput.includes("border: '#26262E'"), 'Mobile TS must export dark border');
assert.ok(
  tsMobileOutput.includes("textSecondary: '#9E9EA8'"),
  'Mobile TS must export dark textSecondary',
);
assert.ok(tsMobileOutput.includes("textMuted: '#858590'"), 'Mobile TS must export dark textMuted');
assert.ok(tsMobileOutput.includes("accent: '#FF5A36'"), 'Mobile TS must export dark coral accent');
assert.ok(
  tsMobileOutput.includes("statusLive: '#10B981'"),
  'Mobile TS must export dark statusLive',
);
assert.ok(
  tsMobileOutput.includes("streamMobile: '#6366F1'"),
  'Mobile TS must export dark streamMobile',
);

assert.ok(tsMobileOutput.includes('light = {'), 'Mobile TS must export light palette block');
assert.ok(
  tsMobileOutput.includes("background: '#FFFFFF'"),
  'Mobile TS must export light background',
);
assert.ok(tsMobileOutput.includes("border: '#E5E7EB'"), 'Mobile TS must export light border');
assert.ok(
  tsMobileOutput.includes("textSecondary: '#4B5563'"),
  'Mobile TS must export light textSecondary',
);
assert.ok(tsMobileOutput.includes("textMuted: '#6B7280'"), 'Mobile TS must export light textMuted');
assert.ok(tsMobileOutput.includes("accent: '#C43A17'"), 'Mobile TS must export light coral accent');
assert.ok(
  tsMobileOutput.includes("statusLive: '#059669'"),
  'Mobile TS must export light statusLive',
);
assert.ok(
  tsMobileOutput.includes("streamMobile: '#4F46E5'"),
  'Mobile TS must export light streamMobile',
);

assert.ok(
  tsMobileOutput.includes('export const Colors = {'),
  'Mobile TS must export Colors object',
);
assert.ok(
  tsMobileOutput.includes('...dark,'),
  'Mobile TS Colors object must spread dark palette by default',
);

// 2. Validate committed artifacts have not drifted
const repoRoot = path.resolve(__dirname, '../..');
const localWeb = path.resolve(repoRoot, 'src/styles/tokens.css');
const localDesktop = path.resolve(repoRoot, 'src/tokens.css');
const localMobile = path.resolve(repoRoot, 'src/constants/colors.ts');
const normalizeLf = (s) => s.replace(/\r\n/g, '\n');

if (fs.existsSync(localWeb)) {
  const current = fs.readFileSync(localWeb, 'utf8');
  assert.strictEqual(
    normalizeLf(current),
    normalizeLf(cssOutput),
    'Committed src/styles/tokens.css drifted from compiler output. Run `npm run build:tokens`.',
  );
}
if (fs.existsSync(localDesktop)) {
  const current = fs.readFileSync(localDesktop, 'utf8');
  assert.strictEqual(
    normalizeLf(current),
    normalizeLf(cssOutput),
    'Committed src/tokens.css drifted from compiler output. Run `npm run build:tokens`.',
  );
}
if (fs.existsSync(localMobile)) {
  const current = fs.readFileSync(localMobile, 'utf8');
  assert.strictEqual(
    normalizeLf(current),
    normalizeLf(tsMobileOutput),
    'Committed src/constants/colors.ts drifted from compiler output. Run `npm run build:tokens`.',
  );
}

// 3. Pure unit compiler test with dedicated independent fixture
const independentUnitFixture = {
  colors: {
    dark: {
      bg: '#010101',
      ink: '#EEEEEE',
      gray50: '#050505',
      gray100: '#101010',
      gray200: '#202020',
      gray300: '#303030',
      gray400: '#404040',
      gray500: '#505050',
      coralAccent: '#FF0011',
      coralTint: 'rgba(255, 0, 17, 0.2)',
      statusLive: '#00FF11',
      streamMobile: '#0011FF',
      streamTauri: '#00FF22',
    },
    light: {
      bg: '#FEFEFE',
      ink: '#020202',
      gray50: '#F9F9F9',
      gray100: '#F1F1F1',
      gray200: '#E1E1E1',
      gray300: '#D1D1D1',
      gray400: '#717171',
      gray500: '#414141',
      coralAccent: '#C00011',
      coralTint: 'rgba(192, 0, 17, 0.2)',
      statusLive: '#00C011',
      streamMobile: '#0011C0',
      streamTauri: '#00C022',
    },
  },
  typography: {
    fontBody: 'unit-sans',
    fontMono: 'unit-mono',
  },
  radii: {
    sm: '2px',
    md: '4px',
    lg: '8px',
    pill: '999px',
  },
  shadows: {
    cardDark: '0 4px 8px #000',
    cardLight: '0 2px 4px #aaa',
  },
  textures: {
    halftoneDark: 'radial-dark',
    halftoneLight: 'radial-light',
  },
};

const unitResult = compileTokens(independentUnitFixture);

// Verify typography, radii, shadows, and textures mapping
assert.ok(unitResult.cssOutput.includes('--font-body: unit-sans;'));
assert.ok(unitResult.cssOutput.includes('--font-mono: unit-mono;'));
assert.ok(unitResult.cssOutput.includes('--radius-sm: 2px;'));
assert.ok(unitResult.cssOutput.includes('--radius-md: 4px;'));
assert.ok(unitResult.cssOutput.includes('--radius-lg: 8px;'));
assert.ok(unitResult.cssOutput.includes('--radius-pill: 999px;'));
assert.ok(unitResult.cssOutput.includes('--card-shadow: 0 2px 4px #aaa;'));
assert.ok(unitResult.cssOutput.includes('--card-shadow: 0 4px 8px #000;'));
assert.ok(unitResult.cssOutput.includes('--halftone: radial-light;'));
assert.ok(unitResult.cssOutput.includes('--halftone: radial-dark;'));

// Verify colors mapping
assert.ok(unitResult.cssOutput.includes('--bg: #FEFEFE;'));
assert.ok(unitResult.cssOutput.includes('--bg: #010101;'));
assert.ok(unitResult.cssOutput.includes('--coral-accent: #C00011;'));
assert.ok(unitResult.cssOutput.includes('--coral-accent: #FF0011;'));

// Verify mobile TS mapping
assert.ok(unitResult.tsMobileOutput.includes("background: '#010101'"));
assert.ok(unitResult.tsMobileOutput.includes("backgroundSelected: '#202020'"));
assert.ok(unitResult.tsMobileOutput.includes("textSecondary: '#505050'"));
assert.ok(unitResult.tsMobileOutput.includes("textMuted: '#404040'"));
assert.ok(unitResult.tsMobileOutput.includes("accent: '#FF0011'"));
assert.ok(unitResult.tsMobileOutput.includes("statusLive: '#00FF11'"));
assert.ok(unitResult.tsMobileOutput.includes("streamMobile: '#0011FF'"));

assert.ok(unitResult.tsMobileOutput.includes("background: '#FEFEFE'"));
assert.ok(unitResult.tsMobileOutput.includes("backgroundSelected: '#E1E1E1'"));
assert.ok(unitResult.tsMobileOutput.includes("textSecondary: '#414141'"));
assert.ok(unitResult.tsMobileOutput.includes("textMuted: '#717171'"));
assert.ok(unitResult.tsMobileOutput.includes("accent: '#C00011'"));
assert.ok(unitResult.tsMobileOutput.includes("statusLive: '#00C011'"));
assert.ok(unitResult.tsMobileOutput.includes("streamMobile: '#0011C0'"));

console.log('✔ Token compiler tests passed successfully.');
