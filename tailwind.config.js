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
      fontSize: {
        xs: ['1rem', { lineHeight: '1.375rem' }],        // was 0.75rem/1rem   (12px/16px) → 16px/22px  (+33%)
        sm: ['1.125rem', { lineHeight: '1.625rem' }],     // was 0.875rem/1.25rem (14px/20px) → 18px/26px (+29%)
        base: ['1.25rem', { lineHeight: '1.875rem' }],    // was 1rem/1.5rem    (16px/24px) → 20px/30px  (+25%)
        lg: ['1.375rem', { lineHeight: '2rem' }],         // was 1.125rem/1.75rem (18px/28px) → 22px/32px (+22%)
        xl: ['1.5rem', { lineHeight: '2.125rem' }],       // was 1.25rem/1.75rem (20px/28px) → 24px/34px  (+20%)
        '2xl': ['1.75rem', { lineHeight: '2.375rem' }],   // was 1.5rem/2rem    (24px/32px) → 28px/38px   (+17%)
        '3xl': ['2.125rem', { lineHeight: '2.625rem' }],  // was 1.875rem/2.25rem (30px/36px) → 34px/42px (+13%)
        '4xl': ['2.5rem', { lineHeight: '2.875rem' }],    // was 2.25rem/2.5rem (36px/40px) → 40px/46px   (+11%)
        '5xl': ['3.375rem', { lineHeight: '1' }],         // was 3rem          (48px) → 54px              (+13%)
        '6xl': ['4.25rem', { lineHeight: '1' }],          // was 3.75rem       (60px) → 68px              (+13%)

        // Semantic tokens, kept in sync with the scale above (body-md ≈ new
        // base, body-sm ≈ new sm, label-caps/metadata ≈ new xs) — still only
        // used in a couple of components, but consistent if adopted further.
        'headline-xl': ['2.75rem', { lineHeight: '3.25rem', letterSpacing: '-0.02em', fontWeight: '700' }], // 44px/52px
        'headline-lg': ['2.125rem', { lineHeight: '2.625rem', letterSpacing: '-0.01em', fontWeight: '600' }], // 34px/42px
        'title-md': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],     // 24px/32px
        'body-md': ['1.25rem', { lineHeight: '1.875rem' }],                   // 20px/30px
        'body-sm': ['1.125rem', { lineHeight: '1.625rem' }],                  // 18px/26px
        'label-caps': ['1rem', { lineHeight: '1.375rem', letterSpacing: '0.05em', fontWeight: '700' }], // 16px/22px
        metadata: ['1rem', { lineHeight: '1.375rem' }],                       // 16px/22px
      },
    },
  },
  plugins: [],
}
