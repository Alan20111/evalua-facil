# Evalúa Fácil — Sistema de Diseño (Design System Spec)

> Documento maestro del patrón de diseño actual, extraído del código fuente (React 19 + Tailwind v3 + lucide-react).
> Pensado para importarse a **Stitch / Figma** como fuente de verdad: tokens, componentes, pantallas e inconsistencias a corregir.
> Fecha de auditoría: 2026-07-11 · Rama: `test`

---

## 1. Identidad de producto

| Atributo | Valor |
|---|---|
| Producto | Evalúa Fácil — gestión de calificaciones, actividades y evaluaciones para docentes SEP (México) |
| Plataformas objetivo | Web desktop (docente), Web móvil / Android (alumno), tabletas (ambos) |
| Tipografía única | **Outfit Variable** (fallback: Outfit, system-ui, -apple-system, sans-serif) |
| Iconografía | **lucide-react** (stroke icons), 1 excepción: GoogleIcon propio |
| Idioma UI | Español (México) |
| Escala global | `html { font-size: 90% }` — todo el sizing rem de Tailwind se reduce 10% |

### Personalidad por módulo (theming por rol)

El producto es **una sola UI con dos personalidades** controladas por `data-role` en el DOM:

| | Docente (`data-role='docente'`) | Alumno (`data-role='alumno'`) |
|---|---|---|
| Metáfora | Herramienta de productividad desktop (Notion/Airtable) | App móvil nativa (cards redondeadas) |
| Acento | Azul eléctrico `#2563EB` | Naranja `#F97316` |
| Radio estándar | `0.5rem` (8px) | `1rem` (16px) |
| Radio de card | `0.875rem` (14px) | `2rem` (32px) |
| Tipografía | Escala reducida (~-1.5%, ver §3) | Escala compartida base |
| Contenedor | Crece con viewport hasta 1600px | Mobile-first, `max-w-2xl` fijo |

---

## 2. Tokens de color

### 2.1 Neutrales / superficies ("luminous neutral")

| Token | Hex | Uso |
|---|---|---|
| `--surface` | `#FAF9FA` | Fondo de página |
| `--surface-dim` | `#D9DADD` | Superficie atenuada |
| `--surface-container` | `#EDEEF0` | Contenedores secundarios, pistas de tabs/segmented, pills neutras |
| `--surface-card` | `#FFFFFF` | Cards, modales, tablas, barras |
| `--on-surface` | `#131B2E` | Texto principal |
| `--on-surface-variant` (`muted`) | `#414753` | Texto secundario |
| `--outline` | `#717785` | Bordes fuertes |
| `--outline-variant` | `#C0C6D5` | Bordes de inputs, divisores, bordes de card |

### 2.2 Acento por rol

| Token | Docente | Alumno |
|---|---|---|
| `--accent` | `#2563EB` | `#F97316` |
| `--accent-hover` | `#1D4ED8` | `#EA580C` |
| `--accent-light` | `#DBEAFE` | `#FFEDD5` |

### 2.3 Lavados de hover (derivados de `--accent` vía color-mix)

| Token | Fórmula | Uso previsto |
|---|---|---|
| `--accent-tint` | accent 12% sobre transparente | Hover de filas, celdas, listas — "perceptible, nunca invasivo" |
| `--accent-tint-strong` | accent 18% | Celda activa de captura |
| `--accent-medium` | accent 28% | Hover de botones, tabs e icon-buttons |

### 2.4 Paletas por materia (`data-subject-palette` — sobreescriben `--accent` dentro de la materia)

| Key | Label | Accent | Hover | Light | bg badge | text badge |
|---|---|---|---|---|---|---|
| `default` | Azul | `#2563EB` | `#1D4ED8` | `#DBEAFE` | `#DBEAFE` | `#1D4ED8` |
| `orange` | Naranja | `#F97316` | `#EA580C` | `#FFEDD5` | `#FFEDD5` | `#C2410C` |
| `purple` | Morado | `#9333EA` | `#7E22CE` | `#F3E8FF` | `#F3E8FF` | `#7E22CE` |
| `green` | Verde | `#16A34A` | `#15803D` | `#DCFCE7` | `#DCFCE7` | `#15803D` |
| `rose` | Rosa | `#E11D48` | `#BE123C` | `#FFE4E6` | `#FFE4E6` | `#BE123C` |
| `teal` | Teal | `#14B8A6` | `#0D9488` | `#CCFBF1` | `#CCFBF1` | `#0D9488` |

Colores de evento de calendario (`EVENT_COLORS`, catálogo paralelo — **desalineado**, ver §10): añade `slate` (`#F1F5F9`/`#475569`) y `blue`, renombra rose → "Rojo".

### 2.5 Colores semánticos (hoy hardcodeados, no tokenizados)

| Semántica | Escala usada | Ejemplos |
|---|---|---|
| Éxito / calificado / correcto / copiado | **emerald** | `emerald-50/100/200/500/600/700` — badge `bg-emerald-100 text-emerald-700` |
| Advertencia / pendiente / tarde / archivada / peso | **amber** | `amber-50/100/200/400/500/600/700/800` — badge `bg-amber-100 text-amber-700` |
| Error / vencido / destructivo | **red** + token `error #BA1A1A` | banner `text-red-600 bg-red-50 border-red-200`, botón `bg-red-600 hover:bg-red-700` |
| Info / entregado | **blue** | `bg-blue-100 text-blue-700` |
| Neutro / jerarquía terciaria | **slate** | `slate-300/400/500`, zebra `bg-slate-50/50`, divisores `divide-slate-100` |
| Extensión de fecha (alumno) | orange crudo | `text-orange-500/600` (⚠ colisiona con accent alumno) |

Color de calificación (`gradeColor`): alta `text-emerald-700` · media `text-amber-600` · baja `text-red-500` · vacía `text-slate-300`.

### 2.6 Colores de marca fuera de sistema (a normalizar)

- PortalBadge: Docente `#39FF14` (verde neón)/texto negro · Estudiante `#FF6600`/texto blanco — pill `px-3 py-1 rounded-full text-xs font-bold tracking-wide`
- Landing: `bg-blue-600` (docente) / `bg-orange-500` (alumno) literales

**✅ resuelto (jul-2026):** el logo (`EFLogo`) ya no lleva fondo blanco horneado en el PNG — `logo-evalua-facil.png`/`logo-icon.png` son transparentes con los colores originales de la marca. **Hay un solo logo** (no existe variante de texto blanco / alto contraste): el logo SIEMPRE se coloca sobre blanco. Sobre superficies de color (los sidebars azules del docente/alumno, el popover del logo) se envuelve en un contenedor blanco (`bg-white rounded-card`), no se cambia el logo. Assets de marca de referencia en `docs/identidad/`.

---

## 3. Tipografía

**Familia:** Outfit Variable. **Base HTML al 90%** → 1rem = 14.4px reales. Los px listados son rem nominales (multiplicar ×0.9 para px de pantalla).

### 3.1 Escala compartida (alumno / default) — utilidades `text-*`

| Utilidad | Tamaño | Line-height | Docente (override) |
|---|---|---|---|
| `text-xs` | 13px | 17px | 12.25 / 16.5 |
| `text-sm` | 15px | 20px | 14.25 / 20 |
| `text-base` | 17px | 23px | 16.25 / 23.5 |
| `text-lg` | 19px | 26px | 18.25 / 27 |
| `text-xl` | 21px | 27px | 20.25 / 27.5 |
| `text-2xl` | 25px | 31px | 24.25 / 31.5 |
| `text-3xl` | 31px | 36px | 30.25 / 36 |
| `text-4xl` | 37px | 41px | 36.25 / 40.5 |
| `text-5xl` | 50px | 1 | 48.5 |
| `text-6xl` | 62px | 1 | 60.5 |

### 3.2 Tokens semánticos (usados en sidebar/headers "sobre azul" — NO cambian por rol)

| Token | Spec |
|---|---|
| `headline-xl` | 41/43px, tracking -0.02em, w700 |
| `headline-lg` | 31/36px, tracking -0.01em, w600 |
| `title-md` | 21/27px, w600 |
| `body-md` | 17/23px |
| `body-sm` | 15/20px |
| `label-caps` | 13/17px, tracking 0.05em, w700, uppercase |
| `metadata` | 13/17px |

### 3.3 Jerarquía típica por pantalla

- H1 de página: `text-xl font-bold` (interior) / `text-2xl font-bold` (dashboard/auth)
- H2 de sección: `text-lg font-semibold` o `font-semibold` + icono 19
- Eyebrow: `text-xs font-bold uppercase tracking-wide text-accent`
- Label de campo: `block text-sm font-medium text-muted mb-1`
- Label caps: `text-xs font-semibold text-muted uppercase tracking-wide`
- Metadatos/hints: `text-xs text-slate-400`
- Dato destacado (nota): `text-5xl font-bold text-accent` + `/{max}` en `text-xl text-slate-400`
- Código de acceso: `font-mono font-bold text-3xl text-accent`
- Micro-tipografía de tabla densa: `text-[10px]` / `text-[11px]`

---

## 4. Forma, elevación y espaciado

### 4.1 Radios

| Token | Docente | Alumno | Uso |
|---|---|---|---|
| `rounded` (DEFAULT) | 8px | 16px | Botones, inputs, items de nav, contenedores medianos |
| `rounded-card` | 14px | 32px | Cards grandes, modales, tablas |
| `rounded-pill` / `rounded-full` | 9999px | 9999px | Badges, avatares, FAB, swatches, toggles |

### 4.2 Sombras

| Token | Valor | Uso |
|---|---|---|
| `shadow-card` | `0 4px 20px rgba(0,0,0,0.04)` | Card en reposo |
| `shadow-card-hover` | `0 6px 24px rgba(0,0,0,0.08)` | Card en hover (en la práctica se usa `hover:shadow-md`) |
| `shadow-lg` | Tailwind | Toast, FAB, header sticky accent |
| `shadow-2xl` | Tailwind | Modales/paneles flotantes |

### 4.3 Contenedores de página

| Contexto | Clases |
|---|---|
| Docente amplio (tablas/grids) — `TEACHER_CONTAINER` | `w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-[1600px] mx-auto` |
| Docente angosto (forms/settings) — `TEACHER_CONTAINER_NARROW` | `w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto` |
| Alumno | `px-4 py-5` (o `py-6`) + `max-w-2xl mx-auto` (listas) / `max-w-xl` (detalle) |
| Auth (ambos) | `min-h-screen flex flex-col items-center justify-center px-4 bg-surface` + card `w-full max-w-sm` |
| Admin | main `p-4 md:p-5 lg:p-8 max-w-7xl` |

### 4.4 Espaciado recurrente

- Padding de página: `px-4 py-4` (docente) / `px-4 py-5–6` (alumno)
- Entre cards de lista: `space-y-2` · Entre secciones/cards de settings: `space-y-4` / `mb-4`
- Padding de card: `p-3` (compacta docente) · `p-4` (media) · `p-5` (form auth) · `p-8` (resultado) · `p-10` (empty alumno)
- Forms: `space-y-3` · Toolbars: `gap-2` · Grupos de icon-buttons: `gap-1`

### 4.5 Breakpoints en uso

- **`md` (768px) es el breakpoint estructural único**: conmuta sidebar↔topbar+bottom-nav en los 3 layouts.
- `sm` (640px): bottom-sheet→modal centrado, grids 1→2 col.
- `lg`/`xl`/`2xl`: solo el ladder de anchos del contenedor docente.
- Safe-area iOS/Android: utilidad `.safe-bottom` (`padding-bottom: env(safe-area-inset-bottom)`), solo en bottom-navs.

### 4.6 Escala z-index observada (sin sistema — normalizar)

`z-10` sticky internos · `z-20` sidebar · `z-30` topbar/bottom-nav/overlay drawer · `z-40` modales de página · `z-50` modales globales/toasts/runner · `z-[60]` sub-modales · `9999` tooltips y datetime picker.

---

## 5. Estructura de navegación (App Shell)

### 5.1 Shell Docente/Alumno (idéntico patrón, distinto acento)

**Desktop (≥768px):**
- Sidebar fija `w-[280px] h-screen sticky top-0 bg-accent text-white` (⚠ en alumno el sidebar fuerza `data-role='docente'` para pintarse azul institucional).
  - Bloque de logo: `px-3 pt-3 pb-2` con recuadro blanco interior `bg-white rounded-card px-3 py-2.5 shadow-card` + `<EFLogo>` (el logo siempre va sobre blanco) + PortalBadge.
  - Perfil: `flex items-center gap-3 px-3 py-2 mx-2 rounded hover:bg-white/10`; avatar `w-9 h-9 rounded-full bg-white` con iniciales `text-accent`; nombre `text-body-sm font-semibold`; sub `text-metadata text-white/70`; `ChevronRight 16`.
  - Item de nav: `px-3 py-1.5 rounded text-body-sm` — activo `bg-white text-accent font-semibold`, inactivo `text-white/80 hover:bg-white/10`.
  - Item de asignatura: `px-3 py-2.5 rounded text-body-sm` — activo `bg-white text-accent font-bold shadow-md`, inactivo `text-white/90 hover:bg-white/15`; icono materia 20.
  - Header de grupo: `label-caps text-white/70 uppercase`.
  - Sección archivadas: colapsable, `border-t border-white/15 max-h-48 overflow-y-auto`.
  - Footer logout: `border-t border-white/15`, botón `text-white/80 hover:bg-white/10 hover:text-white`, `LogOut 17`.
- Main: `flex-1 min-w-0 min-h-screen pb-20 md:pb-0`.

**Móvil (<768px):**
- Topbar: `sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 shadow-card` — logo h-8 + PortalBadge + logout `p-2 text-muted hover:text-error` (`LogOut 20`).
- Bottom-nav: `fixed bottom-0 inset-x-0 z-30 bg-surface-card border-t border-outline-variant safe-bottom` — 3 items `flex-1 flex-col items-center py-2 gap-0.5 text-metadata`, iconos **24** (`LayoutDashboard`, `CalendarDays`, `User`); activo `text-accent`, inactivo `text-muted`.
- FAB (dashboard docente): `fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 w-14 h-14 bg-blue-600 rounded-full shadow-lg` + `Plus 26`.

### 5.2 Shell Admin

- Sidebar `w-64 bg-surface-card border-r border-outline-variant` (drawer en móvil con overlay `bg-black/30`), logo cuadro `w-8 h-8 rounded bg-blue-600` "AD".
- Nav item: `px-3 py-2.5 rounded text-sm` — activo `bg-blue-50 text-blue-700 font-semibold`, inactivo `text-muted hover:bg-surface`. Logout `text-red-400 hover:bg-red-50 hover:text-red-600`.

### 5.3 Header de página interior (docente y alumno)

`bg-surface-card border-b border-outline-variant px-4 py-2` (docente) / `py-3 shadow-card` (alumno):
back `ArrowLeft 22` → icono materia `w-9 h-9 rounded bg-accent-light` + `SubjectIcon 20` → `h1 text-xl/lg font-bold truncate` + subtítulo `text-xs text-slate-400` → acciones a la derecha.

---

## 6. Biblioteca de componentes (anatomía + clases exactas)

### 6.1 Botones

| Variante | Clases canónicas |
|---|---|
| **Primario** (objetivo único) | `py-2.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2` — ✅ unificado en `main` (jul-2026): todo el dialecto `bg-blue-600` migrado a `bg-accent` |
| **Secundario/Outline** | `border border-outline-variant rounded font-semibold text-on-surface hover:bg-surface` |
| **Outline acento** | `border border-accent text-accent rounded hover:bg-[var(--accent-tint)]` |
| **Destructivo** | `bg-red-600 hover:bg-red-700 text-white font-semibold rounded` |
| **Ghost/link** | `text-sm text-slate-500 hover:text-muted` o `text-accent hover:underline` |
| **Icon-button** | `p-2 rounded text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]` — destructivo: `hover:text-red-500 hover:bg-red-50` — icono 21 |
| **CTA punteado** | `w-full py-2.5 rounded(-card) border-2 border-dashed border-accent text-accent text-sm font-semibold hover:bg-accent-light` |
| **FAB** | `w-14 h-14 rounded-full bg-accent text-white shadow-lg` + `Plus 26` |

### 6.2 Inputs y formularios

- **Input estándar:** `w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface` — ✅ el anillo de foco es `focus-visible:` en toda la app (jul-2026): ya no aparece con click de mouse, solo con navegación por teclado. Persisten variantes menores de padding (`py-2`/`py-2.5`, `px-3`/`px-3.5`) sin unificar.
- Input con error: `border-red-400` (+ mensaje `text-red-500 text-xs`).
- Input código/username: añade `font-mono tracking-widest text-center text-lg` + `autoCapitalize="characters"`.
- Numérico de captura: `no-spinner` (oculta flechas), `text-center font-semibold`.
- PasswordInput: input estándar + toggle `Eye/EyeOff` interno.
- Label: `block text-sm font-medium text-muted mb-1` · Hint: `text-xs text-slate-400 mt-1`.
- Checkbox/radio nativos: `accent-[var(--accent)]`.
- **Toggle switch** (admin): pista `h-6 w-11 rounded-full` (`bg-accent` on / `bg-slate-300` off — ✅ ya no `bg-blue-600` fijo), pulgar `h-4 w-4 rounded-full bg-surface-card` (`translate-x-6/translate-x-1`).
- **Banner de error de form:** `text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5`.

### 6.3 Cards

| Tipo | Clases |
|---|---|
| Estándar | `bg-surface-card rounded-card shadow-card p-3..5` (sin borde) |
| Con borde (recursos, empty) | `bg-surface-card rounded-card border border-outline-variant` |
| Fila clicable (lista) | `bg-surface-card rounded-card p-3 shadow-card hover:shadow-md transition-shadow flex items-center gap-3 text-left` + icono en cuadro `w-11..12 h-11..12 rounded bg-accent-light` + `ChevronRight 18-20 text-slate-300` |
| Acordeón (parcial) | `rounded-card overflow-hidden shadow-card`; abierto añade borde `1px solid var(--accent)`; header `px-4 py-2 hover:bg-[var(--accent-medium)]` + chevron 20 |
| Sección acentuada | borde `1px solid var(--accent)` + header `background: var(--accent-light)` + título `color: var(--accent)` (hoy inline styles) |
| Stat card (admin) | `p-4`, label `text-xs text-slate-400 font-medium` + icono 18, valor `text-xl md:text-2xl font-bold` |
| Banner de estado (alumno) | `rounded-card p-4 flex items-center gap-3` — calificado `bg-emerald-50 border-emerald-200`, entregado `bg-accent-light border-accent`, pendiente `bg-surface border-outline-variant`; icono 26 |

### 6.4 Tabs — ✅ consolidado a 2 variantes (jul-2026)

| Variante | Activo | Inactivo |
|---|---|---|
| **Segmented** (docente) `flex gap-1 bg-surface-container p-1 rounded` | `bg-surface-card text-on-surface shadow-card` | `text-muted hover:bg-[var(--accent-medium)]` |
| **Underline** (alumno) barra `border-b px-4 flex gap-1 overflow-x-auto`, tab `px-3 py-2.5 text-sm font-medium border-b-2` | `border-accent text-accent` | `border-transparent text-muted hover:bg-[var(--accent-tint)]` |

El "segmented sólido" del panel de evaluar (ActivityPage) se migró a la variante segmented estándar. El selector de opción tipo "píldora" (CheckoutModal, NuevaFechaEntregaModal) se unificó a `border-accent bg-accent-light text-accent` activo / `border-outline-variant text-muted hover:bg-[var(--accent-tint)]` inactivo — documentado como el mismo patrón que **Outline Accent** (§6.1), no una tercera variante de tab.

### 6.5 Badges / chips

- **Pill de estado:** `text-xs font-semibold px-2 py-0.5 rounded-full` (admin) / `px-2 py-1 rounded-full` (alumno).
  - pendiente `bg-surface-container text-muted` · entregado `bg-blue-100 text-blue-700` (docente) o `bg-accent-light text-accent` (alumno) · calificado `bg-emerald-100 text-emerald-700` · vencido `bg-red-100 text-red-600` · tarde `bg-amber-100 text-amber-700` · archivada `bg-amber-50 text-amber-600` · trial `bg-blue-100 text-blue-700` · cancelada `bg-slate-100 text-slate-600`.
- **Chip de metadato:** `text-xs flex items-center gap-0.5` + `Clock 14` — publicado `text-emerald-600`, cierre `text-amber-600` (vencido `text-red-500`), peso `text-amber-700 font-semibold`.
- **Chip neutro:** `bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full`.
- Nota calificada: `text-sm font-bold text-emerald-600` + `Star 13` + `/{max}` `text-xs text-slate-500`.

### 6.6 Tablas

- Contenedor: `bg-surface-card rounded-card shadow-card overflow-hidden` + `overflow-x-auto`; en móvil docente `-mx-4 sm:mx-0` (full-bleed).
- Admin: `table w-full text-sm min-w-[720px]`; thead `bg-surface text-left text-xs text-muted uppercase`, celdas `px-4 py-2`; tbody `divide-y divide-slate-100`; hover `hover:bg-slate-50/50`; vacío `px-4 py-8 text-center text-slate-400`.
- Calificaciones (docente): sticky col 1 `sticky left-0 z-10`, col nombre `sticky left-8 z-20 w-[210px]`, cabeceras `bg-accent-light`, fila de ponderación `bg-amber-50`, zebra `bg-slate-50/50`, hover de fila `group-hover:bg-[var(--accent-tint)]`, micro-texto `text-[10px]/[11px]`, celdas `w-14/w-9`.
- Acciones por fila: `p-1.5 text-slate-400 hover:text-{blue|amber|red}-600 rounded` + `data-tooltip`, iconos 16.

### 6.7 Modales

**Patrón objetivo (bottom-sheet responsive):**
- Wrapper `fixed inset-0 z-50 flex items-end sm:items-center justify-center`
- Backdrop — ✅ **patrón canónico fijado (jul-2026), no usar otra solución:** `<button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={cerrar} aria-label="Cerrar" />`, hermano del panel (nunca lo envuelve). Es un `<button>` real y enfocable — no `<div role="presentation">` ni `aria-hidden` — para que el cierre por teclado/lector de pantalla funcione sin depender de que exista otro botón de cierre visible. El panel ya no necesita `onClick={e => e.stopPropagation()}` porque es hermano del backdrop, no su hijo.
- Panel `relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-{sm|lg|3xl} rounded-t-card sm:rounded-card p-4..5 shadow-2xl max-h-[92vh] overflow-y-auto`
- Header: `flex items-center justify-between` + `h3 text-lg font-bold` + cerrar `p-1..2 text-slate-400 hover:text-error` (`X 18-20`)
- Footer: `flex gap-2` — cancelar outline + acción primaria.
- Confirmación destructiva: `max-w-sm`, botón `bg-red-600`, borrado de materia exige teclear texto de confirmación.
- Editores fullscreen (EvaluacionEditor/EntregableEditor/Runner): `fixed inset-0 z-50 bg-surface overflow-y-auto` + header sticky `bg-accent text-white shadow-lg`, contenido `max-w-3xl mx-auto px-4 py-6`.

### 6.8 Toasts y notificaciones

- Stack `fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]`.
- Item: `flex items-center gap-3 rounded px-4 py-2.5 shadow-lg text-white text-sm` — success `bg-emerald-500` (CheckCircle 20) · warning `bg-amber-500` (AlertTriangle) · error `bg-red-500` (XCircle) + cerrar `X 16`. Auto-dismiss 3500ms. Warning/error suenan (2 beeps WebAudio 740/554Hz). ⚠ Sin animación de entrada/salida.
- Aviso contextual (`notify.showNear`): flotante junto al elemento, radius 8, `padding 6px 12px`, 12px w600, auto-oculta 2600ms — warning `#FFFBEB/#B45309/#FCD34D`, error `#FEF2F2/#B91C1C/#FCA5A5`.
- Tooltips: atributo `data-tooltip` (CSS puro) — caja `#F5F5F5` texto `#111`, borde `#C0C0C0`, 11px, radius 2, max 340px, delay 250ms; variantes `nowrap`, `pos=left`, `pos=bottom`.

### 6.9 Estados vacíos / carga / resultado

- **Empty:** card `rounded-card border border-outline-variant p-8..10 text-center` + icono 28–40 `text-slate-300` (o círculo `w-14 h-14 rounded-full bg-blue-50` + icono `text-blue-400`) + texto `text-sm text-muted` + CTA primario opcional.
- **Loading de página:** `flex justify-center py-16..20` + Spinner. Spinner: `animate-spin rounded-full border-2 border-accent border-t-transparent` — sm 16px / md 24px / lg 40px — ✅ ya no azul fijo, respeta el rol activo.
- **Pantalla de resultado** (verify/pago): card centrada `p-8 max-w-sm text-center` + círculo `w-16 h-16 rounded-full bg-{emerald|amber|red}-100` + icono lucide 32 + `h2 text-xl font-bold` + botón primario. ✅ VerifyEmail unificado a lucide (`CheckCircle2`/`XCircle`/`AlertTriangle`) + `emerald`, mismo patrón que PagoResultado.

### 6.10 Pickers y selects custom

- **IconSelect:** grid `grid-cols-6 sm:grid-cols-8 gap-1.5`, celda `aspect-square rounded` — activo `bg-accent text-white`, idle `bg-surface-container text-muted hover:bg-[var(--accent-tint)]`, icono 19.
- **PaletteSelect:** swatches `w-9 h-9 rounded-full`, seleccionado `ring-2 ring-offset-2 ring-slate-400 scale-105` + `Check 18 text-white`, hover `scale-105`.
- **VisibilitySelect / opciones tipo tarjeta-radio:** `flex items-center gap-2 p-3 rounded border cursor-pointer hover:bg-[var(--accent-tint)]` — seleccionado borde `var(--accent)` + fondo `var(--accent-light)`.
- **FileTypeSelect:** checklist `border rounded divide-y`, opción `px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)]`, activo `text-accent font-medium`.
- **EFDateTimePicker:** trigger tipo input (borde outline-variant, icono Calendar accent); popover portal radius 14, sombra `0 8px 40px`, header lavado accent 10%, chips de atajos pill, calendario (días circulares 28px — seleccionado fondo accent, hoy outline accent 35%) + ruedas hora/min/AM-PM (item 26px, resalte accent 12%), footer Borrar/Cancelar/Confirmar (accent + Check 13). Animaciones `ef-pop-in` 200ms.
- **RichTextEditor (TipTap):** marco `border rounded bg-surface-card`; toolbar `p-1.5 border-b bg-surface`, botón `p-1.5 rounded disabled:opacity-40` — activo `bg-accent-light text-accent`, hover `bg-[var(--accent-tint)]`; iconos 16; separador `w-px h-5 bg-outline-variant`; área `p-3 min-h-[160px] max-h-[40vh]`.
- **FileDropzone:** `border-2 border-dashed rounded p-4 text-center` — idle `border-outline-variant hover:bg-[var(--accent-tint)]`, drag-over/activo `border-accent bg-[var(--accent-tint)]` (alumno: `bg-accent-light`), `Upload 22-26 text-accent`, título `text-sm font-medium`, hint `text-xs text-slate-400`. Alto móvil `h-28 sm:h-32`.
- **AttachmentList:** fila `rounded border bg-surface-card px-2 py-1.5 flex gap-2` — icono por tipo, nombre `text-sm truncate`, tamaño `text-xs text-slate-400`, acciones `p-1 text-slate-400 hover:text-accent` (quitar `hover:text-red-500`), iconos 15.

### 6.11 Patrón de quiz (EvaluacionRunner — modo examen)

- Fullscreen `fixed inset-0 z-50 bg-surface`, sin shell de navegación.
- Header sticky `bg-accent text-white px-4 py-3 shadow-lg`: alumno `text-xl font-bold truncate`, contexto `text-xs text-white/60`, contador "Pregunta X de N", **Timer** `text-sm font-semibold` (`Timer 16`) — crítico <60s `text-red-200`; botón salir `text-xs border border-white/30 rounded px-2 py-1 hover:bg-white/10`.
- Progreso: pista `h-1.5 bg-surface-container rounded-full` + relleno `bg-accent` fluido.
- Card de pregunta `p-4 mb-4`, imagen `max-h-64 object-contain rounded border`, enunciado `text-base font-medium`.
- Opción: label `flex items-center gap-3 p-3 rounded border hover:bg-[var(--accent-tint)]` — seleccionada borde accent + fondo accent-light; radio `accent-[var(--accent)]`.
- Navegación: Anterior ghost (`ChevronLeft 18`, solo si navegación libre, `disabled:opacity-30`) / Siguiente-Finalizar primario `px-5 py-2.5` (`CheckCircle2 18`).
- Revisión (EvaluacionRevision): opción correcta `border-emerald-300 bg-emerald-50 text-emerald-700`; elegida `border-accent bg-accent-light` + `CheckCircle2 15 text-emerald-600` / `XCircle 15 text-error`; retro docente en `bg-surface rounded p-2.5` itálica.

### 6.12 Calendario (docente)

- Toolbars flotantes `bg-surface-card border rounded-card shadow-card px-1 py-1`; botón "Hoy" `text-xs px-3 py-1.5 rounded border`; switcher activo `bg-accent text-white`.
- Grid mes `grid-cols-7`, celda `min-h-[88px]` hover `hover:bg-accent-tint`; "hoy" círculo `bg-accent text-white`; semana `grid-cols-8 min-w-[560px]` con header sticky.
- EventPill: `rounded px-2 py-1 text-xs` con bg/text de la paleta de materia (inline), icono 10.
- Conflicto: `bg-amber-50 border-amber-200 rounded-card text-amber-800` + `AlertTriangle 16`.

### 6.13 Componentes nuevos (post-divergencia, estandarizados jul-2026)

Nacieron en `main` después del trabajo original de este documento y se auditaron/corrigieron en la Etapa 3 del plan de unificación (`docs/PLAN_UNIFICACION_MAIN.md`) — hoy siguen los mismos tokens/patrones que el resto de la app, documentados aquí por primera vez:

- **Zona de programación de bloques** (`ProgramarZonaSemanal.jsx`, `ProgramarBloquesModal.jsx`, `BloqueEditor.jsx`): pantalla completa `fixed inset-0 z-50 bg-surface-card flex flex-col` (⚠ **ya no es una ventana flotante con backdrop** — se rediseñó a pantalla completa; no reintroducir el patrón de backdrop-clicable aquí). Banner de modo (crear/modificar) con `ring-4 ring-amber-400 ring-inset` cuando `esModificar`. Grilla semanal con celdas-hora y bloques arrastrables (Pointer Capture). 3 popovers internos (colocar bloque, editar bloque, confirmar salida) sí siguen el patrón canónico de backdrop de §6.7.
- **Rúbricas** (`components/rubrica/`): `RubricaEditor.jsx` (editor tabla WYSIWYG, agarradera de columnas con `role="slider"`), `RubricaTable.jsx`/`RubricaGradeTable.jsx` (tabla presentacional/de calificación — celda de nivel seleccionada `bg-accent-light`, texto de puntos `text-accent`), `RubricaPicker.jsx` (selector de rúbricas reutilizables).
- **`PublicacionScheduler.jsx`**: selector compartido de "cuándo se publica" (inmediato/ahora/fecha) usado en EvaluacionManager y EvaluacionEditor — un solo componente para que ambos flujos se vean idénticos.
- **`EvaluacionAnswerList.jsx`** / **`EvaluacionStatsPanel.jsx`**: lista de respuestas de solo-lectura (compartida entre revisión del alumno y del docente) y panel de métricas de grupo (`border border-accent` + header `bg-accent-light`, mismo patrón de card acentuada que §6.9).

---

## 7. Iconografía (lucide-react)

**Escala de tamaños (convención observada):**

| Tamaño | Uso |
|---|---|
| 10–13 | Dentro de pills/eventos, Star de nota (13), botón salir runner (13) |
| 14–16 | Chips de metadato, acciones de tabla, toolbar RTE, checks de opciones, X de toast |
| 17–19 | Iconos de sidebar (17), títulos de sección (19), pencil (18), navegación quiz (18) |
| 20–22 | Acciones de header (21), back `ArrowLeft 22`, icono materia (20–22), X modal (20), logout topbar (20) |
| 24–28 | Bottom-nav (24), FAB Plus (26), banners de estado (26), empty medio (28) |
| 32–40 | Hero auth (32), pantallas de resultado (32), empty grande (32–40) |

**Iconos clave por función:** navegación `LayoutDashboard/CalendarDays/User` · volver `ArrowLeft` · agregar `Plus` · cerrar `X` · estados `CheckCircle(2)/Clock/XCircle/AlertTriangle/Circle` · calificación `Star` · archivos `Upload/Download/FileText/Paperclip/FolderOpen` · acciones `Pencil/Copy/Archive/Trash2/QrCode/Link/KeyRound/MoreVertical/Search/Eye/EyeOff` · quiz `Timer/PlayCircle/ListChecks/RotateCcw` · marca `GraduationCap`.

**Catálogo de iconos de materia (32):** book(BookOpen, default), calculator, flask(FlaskConical), atom, globe(Globe2), languages, music, palette, dumbbell, code(Code2), pen(PenTool), microscope, landmark, map, leaf, brain, camera, film, hammer, wrench, cpu, database, sigma, ruler, compass, rocket, lightbulb, graduation(GraduationCap), library, pencil, trophy, star.

---

## 8. Estados interactivos (convención)

| Estado | Patrón |
|---|---|
| Hover superficie/fila | `bg-[var(--accent-tint)]` (12%) |
| Hover botón/tab/icon-button | `bg-[var(--accent-medium)]` (28%) |
| Hover card | `hover:shadow-md` (elevación, no color) |
| Hover sobre acento sólido | `bg-white/10` – `/15` |
| Focus | `focus:outline-none focus:ring-2 focus:ring-accent` (⚠ nunca `focus-visible`; ring aparece con click — corregir a `focus-visible:ring-2`) |
| Disabled | `disabled:opacity-60` (⚠ conviven 30/40/50/60 — estandarizar: 60 general, 40 toolbar) |
| Active/selected | fondo accent sólido + texto blanco, o `bg-accent-light text-accent` |
| Feedback de copiado | cambio a `text-emerald-600 bg-emerald-50` + `animate-bounce` |
| Transiciones | `transition-colors` / `transition-shadow` / `transition-all duration-200` |

---

## 9. Inventario de pantallas (24 vistas)

### Públicas
| Vista | Ruta | Layout | Patrón dominante |
|---|---|---|---|
| Landing (selector de rol) | `/` | Centrado `max-w-2xl` | 2 cards de rol `grid sm:grid-cols-2`, iconos círculo 56px azul/naranja, CTA con gap animado |
| Login docente | `/` | Auth `max-w-sm` | Hero GraduationCap + card p-5 + Google + divisor "o" |
| Registro docente | `/register` | Auth | Ídem + selector de plantel (school picker multi-paso) |
| Login alumno | `/alumno` | Auth (naranja) | Input código font-mono centrado + acordeón "¿Primera vez?" |
| Activación alumno | `/activate/:code` | Auth (naranja) | Máquina 3 pasos: username → password → link_existing; chip de alumno encontrado emerald |
| Reset password | — | Auth | 4 estados (verifying/valid/invalid/done), éxito `CheckCircle2 40 emerald` |
| Verificar email | — | Card resultado p-8 | 4 estados con círculo 64px + SVG (⚠ migrar a lucide) |
| Resultado de pago | — | Card resultado | VARIANTS success/pending/failure lucide 32 |

### Docente (azul, radios 8/14px)
| Vista | Contenedor | Patrón dominante |
|---|---|---|
| Onboarding | Auth | 1 campo nombre |
| Dashboard | NARROW | Saludo + lista de cards de asignatura con reorden (flechas) + FAB + modal Nueva asignatura (bottom-sheet, selector parciales grid-cols-6, PaletteSelect, IconSelect) |
| SubjectPage | CONTAINER (ancho) | Header página + barra icon-buttons 21 + código acceso mono 3xl + tabs segmented + acordeones de parcial + **tabla de calificaciones sticky** + tab estudiantes + tab recursos + menús ⋮ + modales |
| ActivityPage | NARROW + overlay evaluar | Detalle actividad + **overlay fullscreen split** (preview 45vh/flex-1 + panel fijo 380px) con navegación Anterior/Siguiente y form de calificación |
| CalendarPage | `TEACHER_CONTAINER` (✅ ya no `max-w-5xl` propio) | Toolbars flotantes + vistas Agenda/Mes/Semana + EventPills por paleta + entrada a la zona de programación de bloques |
| Zona de programación de bloques (nuevo) | Pantalla completa `fixed inset-0` | Ver §6.13 — sin backdrop (ya no es ventana flotante), grilla semanal con bloques arrastrables |
| Profile | NARROW | Cards de sección p-3 con icono 19 + avatar 80px + badges suscripción + school picker + modales confirmación |
| ProtectAccount | Auth | 2 PasswordInput + "Lo haré después" |

### Alumno (naranja, radios 16/32px)
| Vista | Contenedor | Patrón dominante |
|---|---|---|
| Dashboard | `STUDENT_CONTAINER` (`max-w-2xl`, listado) | Cards de materia con promedio + CTA punteado "Unirme" + modal código |
| SubjectPage | `STUDENT_CONTAINER` (`max-w-2xl`, listado) | Tabs underline + acordeones de parcial + **timeline** (`border-l-2 border-accent`) de actividades con pills de estado + tab calificaciones + recursos |
| ActivityPage | `STUDENT_CONTAINER_NARROW` (`max-w-xl`, detalle) | Banner de estado + nota 5xl + dropzone + chips de archivo + modo evaluación (resumen + botón Comenzar) |
| EvaluacionRunner | Fullscreen | Modo examen: header accent sólido + timer + progreso + card pregunta + opciones radio |
| EvaluacionRevision | `STUDENT_CONTAINER_NARROW` (`max-w-xl`, detalle) | Cards por pregunta solo-lectura con opciones coloreadas — usa `EvaluacionAnswerList` (§6.13), compartido con la revisión del docente |

✅ **`STUDENT_CONTAINER`/`STUDENT_CONTAINER_NARROW`** (`src/config/layout.js`) documentan desde jul-2026 el criterio que antes no estaba escrito en ningún lado: listado = más ancho (varias tarjetas apiladas), detalle = más angosto (lectura/formulario de un solo ítem) — mismo patrón que `TEACHER_CONTAINER`/`TEACHER_CONTAINER_NARROW` del docente.

### Admin (azul hardcodeado)
| Vista | Patrón |
|---|---|
| Dashboard admin | 5 tabs: Resumen (8 stat-cards grid 2/4 + bar charts), Suscripciones/Pagos/Usuarios (patrón tabla común + badges pill + acciones fila), Cobros (PaymentConfig: toggles, cards por método, aviso amber) |

---

## 10. Deuda de diseño — inconsistencias (backlog original + estado en `main`)

> **Estado jul-2026:** los puntos marcados ✅ se ejecutaron en `main` vía `docs/PLAN_UNIFICACION_MAIN.md` (Etapas 0-4, PRs #195/#198/#200/#203 + cierre). Verificado con `npm run lint` (411→203 problemas) y greps de cierre en 0. Los marcados ⚠ **pendiente** siguen abiertos — no se tocaron, quedan para un futuro barrido. Uno (#5, PortalBadge) se marca **decisión revertida**: se corrigió y el usuario luego decidió deliberadamente lo contrario.

**P0 — Sistema de color:**
1. ✅ **Dos dialectos de azul**: `bg-blue-600/hover:blue-700/focus:ring-blue-500` migrado a tokens `accent/*` en 17 archivos.
2. ✅ Spinner `border-accent` (ya no `border-blue-600` fijo).
3. ✅ VerifyEmail unificado a `emerald-*` (ya no `green-100/#16A34A`).
4. ✅ `orange-600/500` en fechas extendidas (ActivityPage alumno) → `amber-700/600`.
5. ⚠ **Decisión revertida** — PortalBadge se alineó a `bg-accent` en la Etapa A/1c, pero el usuario luego decidió un badge verde lima (`bg-lime-400`) para docente como identidad de marca deliberada (commit `a9f6c3a`, jul-2026). Ya no es deuda: es una excepción de marca a propósito, documentar así si se vuelve a tocar este componente.
6. ⚠ Pendiente: tokenizar semánticos `--success`/`--warning`/`--info` + contenedores (hoy `emerald`/`amber`/`blue` crudos, aunque ya consistentes entre sí).
7. ⚠ Pendiente: 3 catálogos de paleta casi iguales (PALETTES / SUBJECT_PALETTE / EVENT_COLORS) sin unificar a una sola fuente.

**P1 — Componentes duplicados:**
8. ✅ Botón primario unificado (`py-2.5` + `hover:bg-accent-hover` en todos los estados, incluidos Activation/ActivityPage/Runner).
9. ⚠ Pendiente: Input sigue sin un solo componente compartido (3+ `inputCls` locales) — solo se unificaron las clases/tokens que usa cada uno, no la arquitectura.
10. ✅ Tabs consolidadas a 2 variantes (ver §6.4) — el tercer estilo sólido y la píldora divergente ya no existen.
11. ✅ Card de resultado: una sola implementación (lucide + emerald) en VerifyEmail y PagoResultado.
12. ✅ Modal: un solo patrón de backdrop (ver §6.7) — normalizado tras detectar que 3 grupos de trabajo distintos habían convergido en 3 soluciones técnicas diferentes (botón enfocable / botón oculto / div con `role="presentation"`); se fijó el patrón por adelantado en la segunda ronda y convergió limpio.
13. ✅ Hover-tint con criterio único: `accent-tint` = superficies (filas/celdas/listas), `accent-medium` = controles (botones/tabs/icon-buttons).
14. ✅ Estilos inline de acento (`style={{ color: 'var(--accent)' }}` etc.) migrados a clases (`text-accent`/`bg-accent-light`/`border-accent`) en SubjectPage, ActivityPage, RubricaEditor, RubricaGradeTable, RubricaTable, EvaluacionStatsPanel.
15. ⚠ Pendiente: zebra `bg-slate-50/50` y `divide-slate-100` sin tokenizar (fuera del alcance del barrido, no se tocó).

**P2 — Layout y accesibilidad:**
16. ✅ CalendarPage `max-w-5xl` → `TEACHER_CONTAINER`.
17. ✅ Alumno: `max-w-xl`/`max-w-2xl` documentados como `STUDENT_CONTAINER_NARROW`/`STUDENT_CONTAINER` (ver §9).
18. ⚠ Pendiente: botón "volver" sin criterio único de visibilidad desktop.
19. ✅ `focus:` → `focus-visible:` en todo el sistema (incluidos los ~7 componentes nuevos de calendario/rúbrica). El avatar y demás controles sin ring visible no se auditaron específicamente — revisar si se vuelve a tocar Profile.
20. ✅ `disabled:opacity-*` estandarizado (60 general / 40 icon-button de toolbar), 0 residuales en 20/30/50.
21. ⚠ Pendiente: escala z-index formal — no se tocó.
22. ⚠ Pendiente: Runner sin `safe-bottom` — fuera del alcance de este plan (es Etapa B, móvil, del plan maestro `PLAN_MAESTRO_UI_MOVIL_PUSH.md`, no ejecutada).
23. ⚠ Pendiente: workaround anti-doble-tap aplicado a medias — no se tocó.
24. ⚠ Pendiente: Toast sin animación de entrada/salida — no se tocó.
25. ✅ VerifyEmail: SVG a mano → lucide-react.
26. ⚠ Pendiente: tooltips `data-tooltip` sin equivalente accesible por teclado — no se tocó.

**Accesibilidad (jsx-a11y, medido con ESLint — no estaba en el backlog original, se agregó como guardrail en jul-2026):**
27. ✅ 231 violaciones → 23 (100% `no-autofocus` revisadas caso por caso y justificadas con comentario, 0% suprimidas con `eslint-disable` salvo el falso positivo documentado de `PortalBadge role=`). Cubre `click-events-have-key-events`, `no-static-element-interactions`, `label-has-associated-control`, `aria-role`.

---

## 11. Lineamientos de privacidad y seguridad en la UI (estado actual + requisitos)

**Ya implementado (preservar en el rediseño):**
- Aislamiento multi-tenant en Firestore rules (verificado con emulador) — la UI nunca debe mostrar datos de otra escuela.
- Sandbox de iframes en previews de archivos; confirmación explícita de pago; HTML sanitizado (`sanitizeHtml`) para descripciones enriquecidas.
- Contraseñas: alumno elige la suya (sin claves temporales visibles); PasswordInput con toggle; recuperación server-side (`api/student/recover-password`).
- Acciones destructivas con fricción (borrar materia exige teclear confirmación).
- `aria-label` en botones de icono + `htmlFor/id` en labels (pase P1 a11y hecho).

**Requisitos para el plan de mejora:**
- Datos de menores (alumnos): mostrar solo nombre/username en pantallas compartibles (proyector); nunca exponer listas de calificaciones completas sin acción explícita del docente.
- Sin datos personales en URLs/query strings; códigos QR de activación no deben incluir datos del alumno más allá del código.
- Estados de sesión visibles (quién soy, qué rol, botón de salir accesible en toda pantalla — hoy cumplido vía topbar/sidebar).
- Touch targets ≥44×44px (Android/WCAG) — auditar icon-buttons `p-1`/`p-1.5` (28–32px hoy) en tablas y attachments.
- Contraste AA: verificar `text-slate-400` sobre blanco (≈3.5:1, insuficiente para texto pequeño) y `text-white/60-70` sobre accent.
- Modo examen (Runner): mantener fullscreen sin fugas de navegación; timer siempre visible; autosave por respuesta (ya existe).

---

## 12. Resumen ejecutivo para Stitch/Figma

**Construir el kit con estas páginas:**
1. **Foundations**: colores (§2 completo, con los 3 lavados de accent), tipografía Outfit (§3, ambas escalas), radios/sombras/espaciado (§4), grid (contenedores §4.3), iconografía (§7).
2. **Componentes**: botones (7 variantes §6.1), inputs (§6.2), cards (7 tipos §6.3), tabs (2 variantes objetivo §6.4), badges (§6.5), tabla (2 variantes §6.6), modal bottom-sheet (§6.7), toast (§6.8), empty/loading/resultado (§6.9), pickers (§6.10).
3. **Patrones**: app shell (sidebar 280px accent / topbar+bottom-nav móvil §5), header de página, acordeón de parcial, timeline alumno, tabla de captura sticky, modo examen (§6.11), calendario (§6.12).
4. **Pantallas**: las 24 del inventario (§9), en 3 breakpoints: 375 (móvil), 768 (tablet), 1440 (desktop).
5. **Variables/modos en Figma**: crear modos "Docente" (azul, radios 8/14) y "Alumno" (naranja, radios 16/32) sobre las mismas variables `accent/*` y `radius/*` — replica exactamente el mecanismo `data-role` del código. Las 6 paletas de materia como modo adicional o estilos alternos.
