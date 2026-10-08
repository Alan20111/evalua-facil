/** @type {import('tailwindcss').Config} */
// Clases propias de forma (oct-2026): en un plugin, no en index.css, para que el
// linter (better-tailwindcss) las reconozca como clases válidas.
//  · barra-flotante-sup/inf: barras móviles en cápsula, separadas 0.5rem del
//    borde + el área segura (como posición/margen, así miden EXACTO --barra-alto).
//  · hoja: hoja inferior (modal tipo sheet) 100% redonda que flota sobre el borde
//    inferior en móvil; en escritorio no hace nada (modal centrado).
const formaApp = ({ addComponents, addBase }) => {
  // Los @keyframes que usa `.hoja` se declaran aquí: Tailwind solo emite los de
  // `theme.keyframes` cuando alguna clase animate-* los usa.
  addBase({
    '@keyframes hoja-sube': {
      from: { opacity: '0', transform: 'translateY(24px)' },
      to: { opacity: '1', transform: 'translateY(0)' },
    },
    '@keyframes aparece': {
      from: { opacity: '0', transform: 'translateY(8px)' },
      to: { opacity: '1', transform: 'translateY(0)' },
    },
    '@keyframes dialogo': {
      from: { opacity: '0', transform: 'scale(0.96)' },
      to: { opacity: '1', transform: 'scale(1)' },
    },
  })
  addComponents({
  '.barra-flotante-sup': {
    top: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
    marginTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
  },
  '.barra-flotante-inf': {
    bottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
  },
  // Cascada (listas: asignaturas, parciales): cada hijo entra subiendo 8px,
  // 30ms después del anterior (micro cascada de la skill: < 200ms en total).
  '.cascada > *': {
    animation: 'aparece 250ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
  },
  '.cascada > *:nth-child(2)': { animationDelay: '30ms' },
  '.cascada > *:nth-child(3)': { animationDelay: '60ms' },
  '.cascada > *:nth-child(4)': { animationDelay: '90ms' },
  '.cascada > *:nth-child(5)': { animationDelay: '120ms' },
  '.cascada > *:nth-child(6)': { animationDelay: '150ms' },
  '.cascada > *:nth-child(n+7)': { animationDelay: '180ms' },
  // Entrada: en el teléfono la hoja SUBE (viene del borde inferior); en
  // escritorio es un diálogo centrado y CRECE desde 96%.
  '.hoja': {
    animation: 'dialogo 250ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
    '@media (max-width: 639.98px)': {
      marginBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
      animation: 'hoja-sube 350ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
    },
  },
  })
}

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
          soft: 'var(--accent-soft)',
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
        hint: 'var(--on-surface-hint)',
        skeleton: 'var(--skeleton)',
        outline: {
          DEFAULT: 'var(--outline)',
          variant: 'var(--outline-variant)',
        },
        error: '#ba1a1a',
        'error-container': '#ffdad6',
      },
      // Only DEFAULT is overridden (standard pill radius) + semantic card/pill.
      // Existing lg/xl/2xl keep Tailwind defaults so legacy usages don't balloon.
      // DEFAULT/card read from CSS vars (src/index.css) so the teacher module
      // can use tighter corners (productivity-tool feel) while the student
      // module keeps the original rounder values — same utility classes
      // (`rounded`, `rounded-card`), different value per [data-role].
      borderRadius: {
        DEFAULT: 'var(--radius)',      // standard elements: buttons, inputs, sidebar items, medium containers
        card: 'var(--radius-card)',    // large cards / dashboard containers
        pill: '9999px',
      },
      // ── Movimiento (oct-2026, skill motion-design) ──────────────────────
      // Personalidad CORPORATIVA: limpia y decidida, sin rebotes en la UI.
      //  · Curva firma (80% de las transiciones): cubic-bezier(0.2, 0, 0, 1)
      //  · Entradas: desaceleran (emphasized 0.05,0.7,0.1,1). Salidas: aceleran.
      //  · Duraciones: rápida 150ms (hover, presión), estándar 250ms (iconos,
      //    tarjetas, diálogos centrados), lenta 350ms (hojas que suben).
      //  · Bucles ambientales: seno (0.37,0,0.63,1), sin cortes.
      // Todo se apaga con prefers-reduced-motion (index.css). Modo de relleno
      // `backwards`: al terminar no queda ningún transform puesto (un transform
      // permanente rompe los position:fixed de dentro: menús, flotantes).
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)',
        firma: 'cubic-bezier(0.2, 0, 0, 1)',
        entrada: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        salida: 'cubic-bezier(0.3, 0, 1, 1)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
        rapida: '150ms',
        estandar: '250ms',
        lenta: '350ms',
      },
      keyframes: {
        // Latido de atención (pestaña/botón rojos): halo de 6px que respira.
        // Los contenedores con overflow-hidden deben dejar p-2 de sitio.
        atencion: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(220, 38, 38, 0.45)' },
          '50%': { boxShadow: '0 0 0 6px rgba(220, 38, 38, 0)' },
        },
        // Fondo oscuro de modales y hojas: solo se desvanece (no se mueve).
        velo: { from: { opacity: '0' }, to: { opacity: '1' } },
        // Hoja inferior (teléfono): sube 24px y aparece; posición = primaria,
        // opacidad = secundaria.
        'hoja-sube': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Diálogo centrado: crece desde 96% (peso pesado: sin rebote).
        dialogo: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Aviso (toast): baja 8px desde arriba, de donde viene.
        aviso: {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Éxito (p. ej. «Copiado»): pop de escala, un solo leve sobrepaso.
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        // Cambio de página: SOLO opacidad. Un transform en el contenedor de la
        // página volvería relativos a él los elementos fixed de dentro.
        pagina: { from: { opacity: '0' }, to: { opacity: '1' } },
        // Cambio de vista (calendario): aparece subiendo 8px.
        aparece: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        atencion: 'atencion 2.2s cubic-bezier(0.37, 0, 0.63, 1) infinite',
        velo: 'velo 200ms cubic-bezier(0.2, 0, 0, 1) backwards',
        'hoja-sube': 'hoja-sube 350ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        dialogo: 'dialogo 250ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        aviso: 'aviso 250ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        pop: 'pop 300ms cubic-bezier(0.2, 0, 0, 1) backwards',
        aparece: 'aparece 250ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        pagina: 'pagina 200ms cubic-bezier(0.2, 0, 0, 1) backwards',
      },
      boxShadow: {
        // Elevación plana (oct-2026, referencia Apple): las tarjetas se
        // separan del lienzo por contraste de superficie + un filo de 1px,
        // no por sombra proyectada. El hover sí levanta un poco.
        card: '0 0 0 1px rgba(19,27,46,0.06)',
        // Footer móvil: sombra suave hacia ARRIBA para separarlo de las tarjetas
        // blancas que pasan por detrás al hacer scroll.
        'barra-sup': '0 -6px 20px rgba(19,27,46,0.10)',
        // Barras móviles flotantes (encabezado y footer en cápsula): sombra suave
        // en todas direcciones para separarlas de las tarjetas que pasan detrás.
        barra: '0 4px 20px rgba(19,27,46,0.12), 0 0 0 1px rgba(19,27,46,0.05)',
        'card-hover': '0 0 0 1px rgba(19,27,46,0.10), 0 6px 20px rgba(19,27,46,0.06)',
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
      //
      // Fifth pass: pass four still read as oversized for an 8-hour-capture
      // tool — elegant was traded for big. This set each tier to the exact
      // midpoint between pass four's value and Tailwind's original default.
      // This pass-five scale is the SHARED default — it's what the student
      // module keeps using (see src/index.css), since the redesign below is
      // teacher-only.
      //
      // Sixth pass (teacher-only): the real complaint wasn't font size
      // anymore, it was component chrome (button/card/row/tab height,
      // padding, radius) — see borderRadius above and the teacher-page
      // spacing changes. Font size only gets one more small nudge, and only
      // for the teacher module this time: each base tier (xs…6xl) resolves
      // through a CSS var so [data-role='docente'] can move it to the
      // midpoint between pass five and the original default again (half the
      // remaining gap) without touching the student experience at all.
      //
      // Seventh pass (teacher-only, white-background content only): one
      // more subtle -0.25px (-0.5px for 5xl/6xl) nudge per tier, staying a
      // hair above Tailwind's original default everywhere — see the actual
      // values under [data-role='docente'] in src/index.css.
      fontSize: {
        xs: ['var(--fs-xs, 0.8125rem)', { lineHeight: 'var(--lh-xs, 1.0625rem)' }],     // 13px/17px (docente: 12.25/16.5; original 12/16)
        sm: ['var(--fs-sm, 0.9375rem)', { lineHeight: 'var(--lh-sm, 1.25rem)' }],        // 15px/20px (docente: 14.25/20; original 14/20)
        base: ['var(--fs-base, 1.0625rem)', { lineHeight: 'var(--lh-base, 1.4375rem)' }], // 17px/23px (docente: 16.25/23.5; original 16/24)
        lg: ['var(--fs-lg, 1.1875rem)', { lineHeight: 'var(--lh-lg, 1.625rem)' }],       // 19px/26px (docente: 18.25/27; original 18/28)
        xl: ['var(--fs-xl, 1.3125rem)', { lineHeight: 'var(--lh-xl, 1.6875rem)' }],      // 21px/27px (docente: 20.25/27.5; original 20/28)
        '2xl': ['var(--fs-2xl, 1.5625rem)', { lineHeight: 'var(--lh-2xl, 1.9375rem)' }], // 25px/31px (docente: 24.25/31.5; original 24/32)
        '3xl': ['var(--fs-3xl, 1.9375rem)', { lineHeight: 'var(--lh-3xl, 2.25rem)' }],   // 31px/36px (docente: 30.25/36; original 30/36)
        '4xl': ['var(--fs-4xl, 2.3125rem)', { lineHeight: 'var(--lh-4xl, 2.5625rem)' }], // 37px/41px (docente: 36.25/40.5; original 36/40)
        '5xl': ['var(--fs-5xl, 3.125rem)', { lineHeight: '1' }],   // 50px (docente: 48.5; original 48)
        '6xl': ['var(--fs-6xl, 3.875rem)', { lineHeight: '1' }],   // 62px (docente: 60.5; original 60)

        // Semantic tokens, kept in sync with the pass-five scale above
        // (body-md ≈ base, body-sm ≈ sm, label-caps/metadata ≈ xs) — still
        // only used in a couple of components, shared by both roles.
        'headline-xl': ['2.5625rem', { lineHeight: '2.6875rem', letterSpacing: '-0.02em', fontWeight: '700' }], // 41px/43px
        'headline-lg': ['1.9375rem', { lineHeight: '2.25rem', letterSpacing: '-0.01em', fontWeight: '600' }],   // 31px/36px
        'title-md': ['1.3125rem', { lineHeight: '1.6875rem', fontWeight: '600' }], // 21px/27px
        'body-md': ['1.0625rem', { lineHeight: '1.4375rem' }],              // 17px/23px
        'body-sm': ['0.9375rem', { lineHeight: '1.25rem' }],                // 15px/20px
        'label-caps': ['0.8125rem', { lineHeight: '1.0625rem', letterSpacing: '0.05em', fontWeight: '700' }], // 13px/17px
        metadata: ['0.8125rem', { lineHeight: '1.0625rem' }],               // 13px/17px
      },
    },
  },
  plugins: [formaApp],
}
