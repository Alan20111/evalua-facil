// One-off generator for the Android launcher icon + splash screen sources,
// derived from the app's own brand mark (public/logo-icon.png — the
// document+checkmark icon already used in the app's own header/sidebar via
// EFLogo). Deliberately NOT the graduation-cap favicon/PWA icon — the
// Android launcher icon uses this different, "real" Evalúa Fácil mark.
// Run once with `node scripts/generate-android-assets.cjs`, then
// `npx capacitor-assets generate --android` consumes resources/*.png.
const sharp = require('sharp')
const path = require('path')

const OUT = path.join(__dirname, '..', 'resources')
const SOURCE = path.join(__dirname, '..', 'public', 'logo-icon.png')

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const TRANSPARENT = { r: 255, g: 255, b: 255, alpha: 0 }
const SPLASH_BG = '#f8fafc'

async function centered(canvasSize, background, logoHeight) {
  const logo = await sharp(SOURCE).resize({ height: logoHeight, fit: 'contain' }).toBuffer()
  const meta = await sharp(logo).metadata()
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background } })
    .composite([{ input: logo, left: Math.round((canvasSize - meta.width) / 2), top: Math.round((canvasSize - meta.height) / 2) }])
    .png()
    .toBuffer()
}

async function main() {
  // Legacy/round launcher icon: logo on a white rounded-square background.
  const iconBg = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
    .composite([{ input: Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" rx="224" fill="#ffffff"/></svg>') }])
    .png().toBuffer()
  const iconLogo = await sharp(SOURCE).resize({ height: 768, fit: 'contain' }).toBuffer()
  const iconLogoMeta = await sharp(iconLogo).metadata()
  await sharp(iconBg)
    .composite([{ input: iconLogo, left: Math.round((1024 - iconLogoMeta.width) / 2), top: Math.round((1024 - iconLogoMeta.height) / 2) }])
    .png().toFile(path.join(OUT, 'icon.png'))

  // Adaptive icon background layer — solid white, no glyph (Android masks it).
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
    .png().toFile(path.join(OUT, 'icon-background.png'))

  // Adaptive icon foreground layer — logo on transparent bg, sized to stay
  // inside Android's ~66% safe zone so it isn't clipped by the mask shape.
  const fgBuf = await centered(1024, TRANSPARENT, 676)
  await sharp(fgBuf).toFile(path.join(OUT, 'icon-foreground.png'))

  // Splash screen — logo centered on the app's light surface color.
  const splashLogo = await sharp(SOURCE).resize({ height: 820, fit: 'contain' }).toBuffer()
  const splashMeta = await sharp(splashLogo).metadata()
  const splashBuf = await sharp({ create: { width: 2732, height: 2732, channels: 4, background: SPLASH_BG } })
    .composite([{ input: splashLogo, left: Math.round((2732 - splashMeta.width) / 2), top: Math.round((2732 - splashMeta.height) / 2) }])
    .png().toBuffer()
  await sharp(splashBuf).toFile(path.join(OUT, 'splash.png'))
  await sharp(splashBuf).toFile(path.join(OUT, 'splash-dark.png'))

  console.log('Generated resources/icon.png, icon-background.png, icon-foreground.png, splash.png, splash-dark.png')
}

main().catch((err) => { console.error(err); process.exit(1) })
