import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compileTokens } from "./build-tokens.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Verify compiler against real tokens.json
const realTokensPath = path.resolve(__dirname, "tokens.json")
assert.ok(fs.existsSync(realTokensPath), "tokens.json must exist")
const realTokens = JSON.parse(fs.readFileSync(realTokensPath, "utf8"))

const { cssOutput, tsMobileOutput } = compileTokens(realTokens)

// CSS assertion checks
assert.ok(
  cssOutput.includes("color-scheme: light;"),
  "CSS root must declare color-scheme: light"
)
assert.ok(
  cssOutput.includes("--bg: #FFFFFF;"),
  "CSS root must define light --bg"
)
assert.ok(
  cssOutput.includes("--coral-accent: #C43A17;"),
  "CSS root must define light --coral-accent"
)
assert.ok(
  cssOutput.includes("color-scheme: dark;"),
  "CSS dark theme must declare color-scheme: dark"
)
assert.ok(
  cssOutput.includes("--bg: #0C0C0F;"),
  "CSS dark selector must define dark --bg"
)
assert.ok(
  cssOutput.includes("--coral-accent: #FF5A36;"),
  "CSS dark selector must define dark --coral-accent"
)
assert.ok(
  cssOutput.includes('body[data-theme="dark"]'),
  "CSS must support data-theme dark selector"
)
assert.ok(
  cssOutput.includes(realTokens.textures.halftoneDark),
  "CSS must include dark halftone texture"
)
assert.ok(
  cssOutput.includes(realTokens.textures.halftoneLight),
  "CSS must include light halftone texture"
)

// Mobile TS assertion checks
assert.ok(
  tsMobileOutput.includes("background: '#0C0C0F'"),
  "Mobile TS must export dark background"
)
assert.ok(
  tsMobileOutput.includes("border: '#26262E'"),
  "Mobile TS must export dark border"
)
assert.ok(
  tsMobileOutput.includes("textSecondary: '#9E9EA8'"),
  "Mobile TS must export dark textSecondary"
)
assert.ok(
  tsMobileOutput.includes("textMuted: '#858590'"),
  "Mobile TS must export dark textMuted"
)
assert.ok(
  tsMobileOutput.includes("accent: '#FF5A36'"),
  "Mobile TS must export dark coral accent"
)
assert.ok(
  tsMobileOutput.includes("statusLive: '#10B981'"),
  "Mobile TS must export dark statusLive"
)
assert.ok(
  tsMobileOutput.includes("streamMobile: '#6366F1'"),
  "Mobile TS must export dark streamMobile"
)

assert.ok(
  tsMobileOutput.includes("light = {"),
  "Mobile TS must export light palette block"
)
assert.ok(
  tsMobileOutput.includes("background: '#FFFFFF'"),
  "Mobile TS must export light background"
)
assert.ok(
  tsMobileOutput.includes("border: '#E5E7EB'"),
  "Mobile TS must export light border"
)
assert.ok(
  tsMobileOutput.includes("textSecondary: '#4B5563'"),
  "Mobile TS must export light textSecondary"
)
assert.ok(
  tsMobileOutput.includes("textMuted: '#6B7280'"),
  "Mobile TS must export light textMuted"
)
assert.ok(
  tsMobileOutput.includes("accent: '#C43A17'"),
  "Mobile TS must export light coral accent"
)
assert.ok(
  tsMobileOutput.includes("statusLive: '#059669'"),
  "Mobile TS must export light statusLive"
)
assert.ok(
  tsMobileOutput.includes("streamMobile: '#4F46E5'"),
  "Mobile TS must export light streamMobile"
)

assert.ok(
  tsMobileOutput.includes("export const Colors = {"),
  "Mobile TS must export Colors object"
)
assert.ok(
  tsMobileOutput.includes("...dark,"),
  "Mobile TS Colors object must spread dark palette by default"
)

// 2. Pure unit compiler test with isolated fixture
const unitFixture = structuredClone(realTokens)
unitFixture.colors.light.bg = "#F0F0F0"
unitFixture.colors.dark.bg = "#111111"

const unitResult = compileTokens(unitFixture)
assert.ok(
  unitResult.cssOutput.includes("--bg: #F0F0F0;"),
  "Unit test: root bg should match light token"
)
assert.ok(
  unitResult.cssOutput.includes("--bg: #111111;"),
  "Unit test: dark bg should match dark token"
)
assert.ok(
  unitResult.tsMobileOutput.includes("background: '#111111'"),
  "Unit test: dark mobile background matches"
)

console.log("✔ Token compiler tests passed successfully.")
