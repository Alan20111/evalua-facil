// One-off generator for the Android launcher icon + splash screen sources,
// derived from the existing PWA brand icon (public/favicon.svg — the same
// graduation-cap mark already used for favicon/icon-192/icon-512/apple-touch-icon).
// Run once with `node scripts/generate-android-assets.js`, then
// `npx capacitor-assets generate --android` consumes resources/*.png.
const sharp = require('sharp')
const path = require('path')

const OUT = path.join(__dirname, '..', 'resources')

const CAP_PATHS = `
  <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>
  <path d="M22 10v6"/>
  <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>
`

// Full icon (background + cap), 1024x1024 — legacy/round launcher icon.
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g transform="translate(108,108) scale(12.333)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    ${CAP_PATHS}
  </g>
</svg>`

// Adaptive icon background layer — solid gradient, no glyph, no rounding
// (Android applies its own mask shape).
const bgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
</svg>`

// Adaptive icon foreground layer — cap glyph only, transparent bg, kept
// inside Android's ~66% safe zone so it isn't clipped by the mask shape.
const fgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <g transform="translate(146,146) scale(8.5)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    ${CAP_PATHS}
  </g>
</svg>`

// Splash screen — brand icon centered on the app's light surface color.
const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  <rect width="2732" height="2732" fill="#f8fafc"/>
  <g transform="translate(1116,1116)">
    <rect width="500" height="500" rx="109" fill="#2563eb"/>
    <g transform="translate(108,108) scale(12.05)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      ${CAP_PATHS}
    </g>
  </g>
</svg>`

async function main() {
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(OUT, 'icon.png'))
  await sharp(Buffer.from(bgSvg)).png().toFile(path.join(OUT, 'icon-background.png'))
  await sharp(Buffer.from(fgSvg)).png().toFile(path.join(OUT, 'icon-foreground.png'))
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(OUT, 'splash.png'))
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(OUT, 'splash-dark.png'))
  console.log('Generated resources/icon.png, icon-background.png, icon-foreground.png, splash.png, splash-dark.png')
}

main().catch((err) => { console.error(err); process.exit(1) })
