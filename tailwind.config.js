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
      // Legibility pass: the whole app is built on Tailwind's default text-*
      // utilities (text-xs … text-6xl), so the single highest-leverage place to
      // raise type size everywhere — without touching every component — is to
      // override that scale here. Each step is bumped ~10–15% over Tailwind's
      // stock values (kept as a comment alongside) so the relative jump between
      // consecutive sizes stays close to the original ratio: small text reads
      // comfortably for older teachers without any one level swallowing the next.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],   // was 0.75rem/1rem (12px/16px) → 14px/20px
        sm: ['1rem', { lineHeight: '1.5rem' }],         // was 0.875rem/1.25rem (14px/20px) → 16px/24px
        base: ['1.125rem', { lineHeight: '1.75rem' }],  // was 1rem/1.5rem (16px/24px) → 18px/28px
        lg: ['1.25rem', { lineHeight: '1.875rem' }],    // was 1.125rem/1.75rem (18px/28px) → 20px/30px
        xl: ['1.375rem', { lineHeight: '1.875rem' }],   // was 1.25rem/1.75rem (20px/28px) → 22px/30px
        '2xl': ['1.625rem', { lineHeight: '2.25rem' }], // was 1.5rem/2rem (24px/32px) → 26px/36px
        '3xl': ['2rem', { lineHeight: '2.5rem' }],      // was 1.875rem/2.25rem (30px/36px) → 32px/40px
        '4xl': ['2.375rem', { lineHeight: '2.75rem' }], // was 2.25rem/2.5rem (36px/40px) → 38px/44px
        '5xl': ['3.25rem', { lineHeight: '1' }],        // was 3rem (48px) → 52px
        '6xl': ['4rem', { lineHeight: '1' }],           // was 3.75rem (60px) → 64px

        // Semantic tokens, bumped to match the scale above (kept in sync: body-md
        // ≈ new base, body-sm ≈ new sm, label-caps/metadata ≈ new xs).
        'headline-xl': ['2.25rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em', fontWeight: '700' }], // 36px/44px
        'headline-lg': ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '-0.01em', fontWeight: '600' }], // 28px/36px
        'title-md': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],                              // 20px/28px
        'body-md': ['1.125rem', { lineHeight: '1.75rem' }],                                                 // 18px/28px
        'body-sm': ['1rem', { lineHeight: '1.5rem' }],                                                      // 16px/24px
        'label-caps': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.05em', fontWeight: '700' }],  // 14px/20px
        metadata: ['0.875rem', { lineHeight: '1.25rem' }],                                                  // 14px/20px
      },
    },
  },
  plugins: [],
}
