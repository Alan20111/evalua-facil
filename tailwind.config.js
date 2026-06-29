/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Outfit Variable"', 'Outfit', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Role/subject accent — resolved from CSS variables (see src/index.css).
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          light: 'var(--accent-light)',
        },
        // Luminous neutral/surface tokens (CSS vars in src/index.css)
        surface: {
          DEFAULT: 'var(--surface)',
          dim: 'var(--surface-dim)',
          container: 'var(--surface-container)',
          card: 'var(--surface-card)',
        },
        'on-surface': 'var(--on-surface)',
        muted: 'var(--on-surface-variant)',
        outline: {
          DEFAULT: 'var(--outline)',
          variant: 'var(--outline-variant)',
        },
        error: '#ba1a1a',
        'error-container': '#ffdad6',
      },
      // Only DEFAULT is overridden (standard pill radius) + semantic card/pill.
      // Existing lg/xl/2xl keep Tailwind defaults so legacy usages don't balloon.
      borderRadius: {
        DEFAULT: '1rem', // standard elements: buttons, inputs, sidebar items, medium containers
        card: '2rem',    // large cards / dashboard containers
        pill: '9999px',
      },
      boxShadow: {
        card: '0 4px 20px rgba(0,0,0,0.04)',
        'card-hover': '0 6px 24px rgba(0,0,0,0.08)',
      },
      maxWidth: {
        container: '1200px',
      },
      // Legibility, second pass: the first round (+10–15%) was judged too timid for
      // the actual audience — teachers in their 40s–60s reading this for hours, not
      // developers glancing at a dashboard. This replaces it with a meaningfully
      // larger scale. The whole app is built on Tailwind's default text-* utilities
      // (text-xs … text-6xl) rather than the semantic tokens below, so overriding
      // the scale here is still the one place that reaches every screen.
      //
      // The increase is NOT a flat px/percentage add — it tapers by level on
      // purpose: the smallest sizes (xs/sm), which carry labels, table headers,
      // badges and helper text, get the biggest relative jump (+30–35%) because
      // that's where squinting actually happens. Large headings get a smaller
      // relative bump (+11–13%) since they're already easy to read and growing
      // them at the same rate would blow up layouts and break the hierarchy gap
      // between "big title" and "huge title". Each step is still clearly bigger
      // than the one before it, so the visual hierarchy is preserved end to end.
      //
      // Third pass: line-height only. Font sizes stayed put — this pass
      // tightened just the lineHeight half of each pair, from a generous
      // prose-like ratio (~1.35–1.5) down to ~1.1–1.33.
      //
      // Fourth pass: the combined result read well but consumed too much
      // screen on the laptops (14"/15"/16") teachers actually use — the real
      // target audience. This step pulls every font-size down by one level
      // (literally: each tier now sits where the tier below it used to be,
      // keeping the same taper shape) while staying above this project's
      // very first scale (Tailwind's defaults) at every tier — i.e. it gives
      // back half of the increase from pass two, it doesn't erase it.
      // Line-heights are recomputed at slightly tighter ratios on top of that
      // (taper ~1.29 → ~1.10), since the brief also asked to keep tightening
      // vertical space, not just hold the line.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.125rem' }],     // 14px/18px (was 16/20; original 12/16)
        sm: ['1rem', { lineHeight: '1.25rem' }],           // 16px/20px (was 18/24; original 14/20)
        base: ['1.125rem', { lineHeight: '1.375rem' }],    // 18px/22px (was 20/26; original 16/24)
        lg: ['1.25rem', { lineHeight: '1.5rem' }],         // 20px/24px (was 22/28; original 18/28)
        xl: ['1.375rem', { lineHeight: '1.625rem' }],      // 22px/26px (was 24/30; original 20/28)
        '2xl': ['1.625rem', { lineHeight: '1.875rem' }],   // 26px/30px (was 28/34; original 24/32)
        '3xl': ['2rem', { lineHeight: '2.25rem' }],        // 32px/36px (was 34/40; original 30/36)
        '4xl': ['2.375rem', { lineHeight: '2.625rem' }],   // 38px/42px (was 40/44; original 36/40)
        '5xl': ['3.25rem', { lineHeight: '1' }],           // 52px (was 54; original 48)
        '6xl': ['4rem', { lineHeight: '1' }],              // 64px (was 68; original 60)

        // Semantic tokens, kept in sync with the scale above (body-md ≈ new
        // base, body-sm ≈ new sm, label-caps/metadata ≈ new xs) — still only
        // used in a couple of components, but consistent if adopted further.
        'headline-xl': ['2.625rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em', fontWeight: '700' }], // 42px/44px
        'headline-lg': ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.01em', fontWeight: '600' }],     // 32px/36px
        'title-md': ['1.375rem', { lineHeight: '1.625rem', fontWeight: '600' }], // 22px/26px
        'body-md': ['1.125rem', { lineHeight: '1.375rem' }],                 // 18px/22px
        'body-sm': ['1rem', { lineHeight: '1.25rem' }],                      // 16px/20px
        'label-caps': ['0.875rem', { lineHeight: '1.125rem', letterSpacing: '0.05em', fontWeight: '700' }], // 14px/18px
        metadata: ['0.875rem', { lineHeight: '1.125rem' }],                  // 14px/18px
      },
    },
  },
  plugins: [],
}
