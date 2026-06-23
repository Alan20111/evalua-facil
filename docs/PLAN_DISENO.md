# Súper plan — Rediseño visual "Luminous Education"

> Migrar TODA la app al sistema de diseño de `DESIGN.md` (estética Material‑3: fuente **Outfit**, **azul eléctrico**, tokens de superficie, formas **pill**, sombras suaves, sidebar de color sólido). Estrategia **token‑first**: se definen tokens semánticos una sola vez y luego se barren los componentes (mecánico y consistente, como se hizo con el `accent`). Documento de ejecución para Sonnet. Convenciones vigentes siguen aplicando (sin rangos en Firestore; `npm run build`+lint por fase).

---

## DECISIÓN #1 (la más importante — confirmar antes de ejecutar)
**¿El rediseño es azul‑único o conserva el theming por rol?**

`DESIGN.md` está construido sobre un **único** primario azul. Pero la app HOY usa **acento por rol** (docente azul / alumno **naranja**) + **paleta por asignatura**, recién implementado a tu pedido.

**Recomendado (Opción A):** adoptar TODO el sistema Luminous (Outfit, superficies, radios, espaciado, sombras, componentes) y **mantener el acento por rol/asignatura** mapeando el token `primary` del diseño a la variable `--accent` existente:
- Neutros/superficies/tipografía/formas/sombras = globales (de Luminous), iguales para todos.
- `primary` = `--accent` = color del rol (docente = azul eléctrico de Luminous; alumno = naranja) y la paleta de la asignatura lo sobrescribe dentro de ella.
- El **azul eléctrico** de Luminous ES el primario del docente → encaja naturalmente. El alumno conserva su naranja. Las paletas por asignatura siguen funcionando.

**Opción B:** azul‑único en toda la app (alumno deja de ser naranja). Contradice el lote anterior. No recomendado salvo que quieras revertir el naranja.

> El resto del plan asume **Opción A**. Si eliges B, solo cambia: `--accent` deja de variar por rol (siempre azul) y se elimina el override naranja.

## OTRAS DECISIONES
2. **Entrega de la fuente Outfit:** recomendado `@fontsource-variable/outfit` (npm, self‑host) → funciona offline (es PWA), sin depender de Google Fonts. Alternativa: `<link>` a Google Fonts (más simple, pero falla sin red). Recomiendo @fontsource.
3. **Sidebar azul sólido:** el diseño pide sidebar con **fondo primario azul + texto blanco** (hoy es blanco). Cambio visual grande pero es central al diseño. Confirmar.
4. **Colores funcionales:** mantener emerald/amber/rose actuales para estados (éxito/alerta/error) o remapearlos a la familia del diseño (`error: #ba1a1a`, etc.). Recomendado: usar `error` del diseño para errores y conservar emerald/amber para éxito/alerta (cohesión suficiente).
5. **Inconsistencia en `DESIGN.md`:** el frontmatter dice `primary: #005cad` y la prosa dice "Electric Blue #2589F5". Recomendado: usar el **set del frontmatter** como fuente de verdad para neutros/superficies, y para el acento docente el azul eléctrico (≈ `#2563eb`/`#2589F5`, prácticamente el actual). Confirmar el azul exacto.

---

## FASE 0 — Fundamentos / tokens (base de todo)

**Archivos:** `package.json` (fuente), `index.html`, `tailwind.config.js`, `src/index.css`.

### 0.1 Fuente Outfit
- `npm i @fontsource-variable/outfit` y en `src/main.jsx` (o `index.css`) importar `@fontsource-variable/outfit`.
- (Opción Google) en `index.html`: `<link>` preconnect + `family=Outfit:wght@400;600;700`.

### 0.2 tailwind.config.js — extender `theme`
```js
theme: {
  extend: {
    fontFamily: { sans: ['"Outfit Variable"', 'Outfit', 'system-ui', 'sans-serif'] },
    colors: {
      // Acento por rol/asignatura (se conserva)
      accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', light: 'var(--accent-light)' },
      // Superficies y neutros Luminous (vía CSS vars)
      surface: { DEFAULT: 'var(--surface)', dim: 'var(--surface-dim)', container: 'var(--surface-container)', card: 'var(--surface-card)' },
      'on-surface': 'var(--on-surface)',
      muted: 'var(--on-surface-variant)',      // texto secundario
      outline: { DEFAULT: 'var(--outline)', variant: 'var(--outline-variant)' },
    },
    borderRadius: { sm: '0.5rem', DEFAULT: '1rem', md: '1.5rem', lg: '2rem', xl: '3rem', full: '9999px' },
    boxShadow: {
      card: '0 4px 20px rgba(0,0,0,0.04)',
      'card-hover': '0 6px 24px rgba(0,0,0,0.08)',
    },
    maxWidth: { container: '1200px' },
    fontSize: {
      'headline-xl': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
      'headline-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '600' }],
      'title-md': ['18px', { lineHeight: '24px', fontWeight: '600' }],
      'body-md': ['16px', { lineHeight: '24px' }],
      'body-sm': ['14px', { lineHeight: '20px' }],
      'label-caps': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '700' }],
      'metadata': ['12px', { lineHeight: '16px' }],
    },
  },
}
```

### 0.3 src/index.css — variables y base
```css
:root {
  --surface: #faf8ff; --surface-dim: #d2d9f4; --surface-container: #eaedff;
  --surface-card: #ffffff;                 /* surface-container-lowest */
  --on-surface: #131b2e; --on-surface-variant: #414753;
  --outline: #717785; --outline-variant: #c0c6d5;
  /* acento docente por defecto (electric blue) */
  --accent: #2563eb; --accent-hover: #1d4ed8; --accent-light: #dbeafe;
}
[data-role='alumno'] { --accent:#f97316; --accent-hover:#ea580c; --accent-light:#ffedd5; }
/* paletas por asignatura: igual que hoy */
@layer base { body { @apply bg-surface text-on-surface font-sans antialiased; } }
```
- `theme-color` en `index.html` → primario (`#2563eb`).

**Aceptación F0:** la app carga con Outfit, fondo `surface`, y `bg-card`/`rounded-lg`/`shadow-card`/`text-muted`/`border-outline-variant` disponibles como utilidades.

---

## FASE 1 — Primitivos reutilizables (para no repetir y barrer rápido)
Crear en `src/components/ui/`:
- **`Card.jsx`** — `bg-card rounded-lg shadow-card p-5` (+ `hover:shadow-card-hover` opcional).
- **`Button.jsx`** — variantes: `primary` (`bg-accent text-white rounded hover:bg-accent-hover`), `ghost` (`text-accent hover:bg-accent-light rounded`). Radio `rounded` (1rem, pill).
- **`Field.jsx`** (input + label) — label en `text-label-caps text-muted uppercase`; input `rounded border border-outline-variant focus:border-accent focus:ring-2 focus:ring-accent/30 bg-card`.
- **`EmptyState.jsx`** — icono en contenedor circular `bg-accent-light` (acento al 15%), texto `text-muted` centrado.
- **`PageTitle.jsx`** — `text-headline-xl` (desktop) / `headline-lg-mobile`.

> No es obligatorio refactorizar todo a estos primitivos de golpe, pero úsalos en componentes nuevos y donde el barrido lo permita. Mínimo: definir las **utilidades semánticas** (abajo) para el sweep.

---

## TABLA DE MAPEO (sweep mecánico — clases viejas → tokens)
| Viejo | Nuevo |
|------|------|
| `bg-slate-50` (canvas) | `bg-surface` |
| `bg-white` (tarjetas/contenedores) | `bg-card` |
| `rounded-2xl` | `rounded-lg` (2rem) |
| `rounded-xl` (contenedores) | `rounded` (1rem) o `rounded-md` según tamaño |
| `shadow-sm` | `shadow-card` |
| `border-slate-200` / `border-slate-100` | `border-outline-variant` |
| `text-slate-900` | `text-on-surface` |
| `text-slate-500` / `text-slate-600` (secundario) | `text-muted` |
| `text-slate-400` (metadatos) | `text-muted` (o `text-metadata`) |
| títulos de página | `text-headline-xl` / `headline-lg` |
| labels de sección sidebar | `text-label-caps` |
| `focus:ring-blue-500` | `focus:ring-accent` (ya migrado) |

> **No tocar** colores semánticos (emerald/amber/rose) salvo errores → `error`. Mantener `accent*` (ya migrado en el lote anterior).

---

## FASES 2–7 — Barrido por área (subagentes en paralelo, 1 archivo c/u)
Cada agente aplica la tabla de mapeo + las specs de componentes, sin tocar lógica. Build + QA visual por fase.

**F2 — Layout / Sidebar (el cambio mayor):**
- Sidebar: `bg-accent` (azul sólido), texto blanco; ítems con hover `bg-white/10`; **estado activo** = `bg-white text-accent rounded`; encabezado "Asignaturas" en `text-label-caps` blanco/translúcido; perfil arriba con avatar circular 32px + 2 líneas; logo con la marca. Banner de prueba: translúcido sobre el azul (texto blanco/blanco‑80, sin caja).
- Ancho fijo `w-[280px]`. Nav móvil inferior adopta superficies nuevas.

**F3 — Dashboard docente + Landing + Login/Register/RegisterSchool:** canvas `surface`, tarjetas `Card`, títulos `headline`, botones/inputs nuevos, FAB pill `bg-accent`. Landing: dos tarjetas grandes `rounded-lg shadow-card`. (Login alumno conserva naranja vía `data-role`.)

**F4 — SubjectPage docente** (tabs, tarjetas de actividad, modales): tabs como segmento pill; tarjetas `Card`; todos los modales a `rounded-lg`, inputs/buttons nuevos. Mantener badges de parcial/estado.

**F5 — ActivityPage docente + Profile:** mismos tokens; tarjetas de envío, modal de calificación, secciones de perfil con `Field`.

**F6 — Alumno (Login, Activation, Dashboard, SubjectPage, ActivityPage):** superficies/forma/tipografía nuevas; el acento sale del rol (naranja) y de la paleta de la asignatura dentro de ella; tarjetas y empty states nuevos.

**F7 — Modales globales + detalles:** confirmar que todos los overlays usan `bg-card rounded-lg`, headers `title-md`, y los `accent-[var(--accent)]` de checkboxes/radios siguen bien.

---

## COMPONENTES — specs clave (de DESIGN.md)
- **Sidebar:** fondo primario, texto blanco, activo = blanco/acento, perfil circular, label‑caps para categorías.
- **Cards:** blanco, padding 20px, radio 32px (`rounded-lg`), sombra `0 4px 20px rgba(0,0,0,.04)`; hover aumenta sombra.
- **Buttons:** primario sólido acento + blanco, radio 1rem; secundario/ghost = texto acento transparente.
- **Inputs:** borde 1px `outline-variant`, foco acento, radio 1rem, label arriba en label‑caps.
- **Empty states:** icono en círculo `bg-accent-light` (acento ~15%), tipografía secundaria centrada.
- **Tipografía:** Outfit en todo; headlines para títulos, label‑caps para encabezados de sidebar, line‑heights generosos.

---

## RIESGOS / EFICIENCIA / ACCESIBILIDAD
- **Sweep enorme (~26 archivos, cientos de clases):** ejecutar con subagentes paralelos (1 archivo c/u), build + QA visual por área; grep final para residuos `slate-`/`rounded-2xl`/`shadow-sm`.
- **Sidebar azul:** verificar contraste texto/acento (blanco sobre azul AA) y estados activos legibles. Para alumno no aplica (sin sidebar).
- **Fuente:** `@fontsource` añade ~peso al bundle pero funciona offline (PWA). Evitar FOUT: `font-display: swap`. Actualizar `theme-color` y, si se quiere, favicon (#4f46e5 → primario).
- **Regresión visual:** alto; por eso token‑first + QA por fase. No cambiar lógica en el sweep.
- **Mantener** `--accent` y `data-subject-palette` (paletas por asignatura del lote anterior) — el diseño se aplica ENCIMA, no los reemplaza.
- **Contraste de neutros:** `on-surface #131b2e` sobre `surface #faf8ff` = excelente; `muted #414753` para secundario.

## ORDEN / ESFUERZO
F0 (tokens) → F1 (primitivos) → F2 (sidebar) → F3–F6 (áreas, paralelizables) → F7 (pulido) → QA visual integral (docente + alumno, claro/oscuro de superficies). Estimado: medio‑grande; el grueso es mecánico una vez fijados los tokens.

## VERIFICACIÓN FINAL
- `npm run build` + lint limpios.
- `grep -rn "slate-\|rounded-2xl\|shadow-sm\|bg-white" src/` → idealmente 0 (o solo casos justificados).
- QA visual: sidebar azul, tarjetas suaves, Outfit aplicado, acento por rol/asignatura intacto, empty states con icono en círculo, login alumno naranja, login docente azul.
