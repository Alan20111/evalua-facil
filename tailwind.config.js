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
      // Third pass: line-height only. Font sizes above stay exactly as they were
      // — this pass tightens just the lineHeight half of each pair, which had
      // carried a generous ratio (~1.35–1.5, prose-like) better suited to
      // long-form reading than a dense form/table-driven app. Ratios now taper
      // from ~1.25 at the smallest sizes down to ~1.1 at the largest headings,
      // following the same taper logic as the size scale above.
      fontSize: {
        xs: ['1rem', { lineHeight: '1.25rem' }],          // 16px/20px (was 16/22, ratio 1.25)
        sm: ['1.125rem', { lineHeight: '1.5rem' }],       // 18px/24px (was 18/26, ratio 1.33)
        base: ['1.25rem', { lineHeight: '1.625rem' }],    // 20px/26px (was 20/30, ratio 1.3)
        lg: ['1.375rem', { lineHeight: '1.75rem' }],      // 22px/28px (was 22/32, ratio 1.27)
        xl: ['1.5rem', { lineHeight: '1.875rem' }],       // 24px/30px (was 24/34, ratio 1.25)
        '2xl': ['1.75rem', { lineHeight: '2.125rem' }],   // 28px/34px (was 28/38, ratio 1.21)
        '3xl': ['2.125rem', { lineHeight: '2.5rem' }],    // 34px/40px (was 34/42, ratio 1.18)
        '4xl': ['2.5rem', { lineHeight: '2.75rem' }],     // 40px/44px (was 40/46, ratio 1.1)
        '5xl': ['3.375rem', { lineHeight: '1' }],         // 54px (unchanged — display size, no leading)
        '6xl': ['4.25rem', { lineHeight: '1' }],          // 68px (unchanged — display size, no leading)

        // Semantic tokens, kept in sync with the scale above (body-md ≈ new
        // base, body-sm ≈ new sm, label-caps/metadata ≈ new xs) — still only
        // used in a couple of components, but consistent if adopted further.
        'headline-xl': ['2.75rem', { lineHeight: '3rem', letterSpacing: '-0.02em', fontWeight: '700' }],   // 44px/48px
        'headline-lg': ['2.125rem', { lineHeight: '2.375rem', letterSpacing: '-0.01em', fontWeight: '600' }], // 34px/38px
        'title-md': ['1.5rem', { lineHeight: '1.875rem', fontWeight: '600' }], // 24px/30px
        'body-md': ['1.25rem', { lineHeight: '1.625rem' }],                  // 20px/26px
        'body-sm': ['1.125rem', { lineHeight: '1.5rem' }],                   // 18px/24px
        'label-caps': ['1rem', { lineHeight: '1.25rem', letterSpacing: '0.05em', fontWeight: '700' }], // 16px/20px
        metadata: ['1rem', { lineHeight: '1.25rem' }],                       // 16px/20px
      },
    },
  },
  plugins: [],
}
