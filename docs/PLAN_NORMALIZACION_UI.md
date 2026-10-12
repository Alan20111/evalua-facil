# Plan de normalización de la interfaz — Evalúa Fácil (oct-2026)

> **Qué es:** el plan para que TODA la app (docente, alumno, admin, pantallas públicas)
> siga un solo estándar de diseño: mismas medidas, misma forma, mismos componentes,
> mismos estados de selección y el mismo lenguaje de movimiento.
>
> **De dónde sale:** de lo que se fue decidiendo en oct-2026 (escalas cerradas de
> radios/sombras/espaciado, píldoras, todo 100 % redondo, hojas de formulario,
> pestañas de dos niveles, esqueletos fieles, sistema de movimiento) y de una
> medición del código el 10-oct-2026 (sección 1).
>
> **Documentos que complementa:** `docs/DESIGN_SYSTEM.md` (la especificación — este
> plan la amplía, no la reemplaza), `docs/PLAN_COMPONENTIZACION.md` (reglas de
> orquestación por archivo, que aquí se reutilizan) y `scripts/check-ui-standards.sh`
> (los candados).

---

## 0. Resumen

Hoy la app *se ve* bastante pareja porque los candados de oct-2026 cerraron radios,
sombras y espaciados. Pero por debajo cada pantalla sigue armando sus propios
botones, campos, pestañas, menús y modales a mano, con medidas distintas. Por eso
reaparecen botones de alturas diferentes, campos medio redondos junto a campos en
píldora y despliegues que aparecen de golpe.

El plan tiene **siete fases**:

| Fase | Qué se hace | Resultado visible |
|---|---|---|
| **0. Contrato** | Escalas nuevas como tokens: altura de control, íconos, fondos de ícono, z-index y movimiento. | Nada todavía; es la base. |
| **1. Librería** | Completar `src/components/ui/` con todos los componentes (unos 25) y una página de catálogo solo para desarrollo. | Cada pieza existe una sola vez, con sus estados y su animación. |
| **2. Migración** | Pantalla por pantalla, cambiar lo hecho a mano por la librería. | Botones del mismo alto, campos de la misma forma y nada redondeado a medias. |
| **3. Selección y preselección** | Un solo lenguaje de «elegido» por tipo de control, y valores iniciales sensatos en cada formulario. | Siempre se nota qué está elegido, y los formularios llegan medio llenos. |
| **4. Movimiento** | Toda aparición se despliega con animación, y los íconos clave tienen microanimación. | La app se siente viva y coherente. |
| **5. Monolitos** | Dividir `SubjectPage` (9 757 líneas), `ActivityPage` y `CalendarPage` antes de migrarlos. | Menos riesgo y PRs más chicos. |
| **6. QA y candados** | Comparación visual automática, accesibilidad, movimiento reducido y nuevos candados que solo pueden bajar. | Que no vuelva a desordenarse. |

Son unos **30 PRs chicos**. Cada uno sale a producción al fusionarse y cada fase
deja una etiqueta de respaldo.

---

## 1. Diagnóstico medido (10-oct-2026, `main` en `436013ab`)

Cifras sacadas con `grep` y un script sobre `src/`. Hay que **regenerarlas al
empezar cada fase**: son una foto de hoy y envejecen con cada merge.

### 1.1 Reutilización de componentes

| Pieza | Hecha a mano | Usando `ui/` | Comentario |
|---|---:|---:|---|
| Botones | **1 079** `<button>` | 12 `<Button>` | `ui/Button` existe desde jul-2026, casi sin uso. |
| Campos de texto | **214** `<input>` | 14 `<Input>` | 7 archivos definen su propio `inputCls`. |
| Áreas de texto | 52 `<textarea>` | — | No hay `ui/Textarea`. |
| Selects | 21 `<select>` | 34 `<Select>` | El más avanzado. |
| Casillas | 39 `type="checkbox"` | 3 `<Checkbox>` | |
| Opciones (radio) | 23 `type="radio"` | — | No hay `ui/Radio`. |
| Modales | 44 archivos con `fixed inset-0` (42 en presupuesto) | 20 archivos con `<Modal>` | Muchos son pantallas completas legítimas (allowlist). |
| Pestañas | 5 barras `role="tablist"` en 3 archivos | `perfil/Pestanas.jsx` (nueva) | Asignatura, perfil y calendario las arman distinto. |
| Interruptores | 7 archivos con su propia versión | — | No hay `ui/Switch`. |

### 1.2 Medidas y forma

| Qué | Hoy | Problema |
|---|---|---|
| Padding de botón primario | **10 combinaciones** (`py-2.5` 58, `px-4 py-2.5` 23, `px-3 py-2` 7, `px-5 py-2.5` 6, `py-3` 5…) | Botones del mismo rol con alturas distintas. |
| Altura explícita de botón | 428 sin altura, 6 con `h-*` distintas | La altura sale del padding y el texto, y por eso varía. |
| Texto de botón | 226 heredan, 174 `text-sm`, 26 `text-xs`, 9 `text-base` | El tamaño de letra también cambia la altura. |
| Radio de botón (muestra de 436) | 215 píldora, **99 `rounded`**, 119 sin radio, 3 `rounded-card` | Mezcla píldora con «medio redondo». |
| Radio de campo (con borde) | **151 `rounded`**, 137 `rounded-full`, 40 `rounded-card` | Es la causa de que se vean «redondeados a medias». |
| Tamaños de ícono (`size=`) | **19 distintos** (16, 18, 14, 15, 20, 13, 17, 22, 12, 11, 28, 32, 19, 24, 21, 26…) | Íconos de 13 y de 15 conviven en la misma barra. |
| Fondos de ícono | `w-8`, `w-9`, `w-10`, `w-11`, `w-12` según pantalla | Ya son redondos (#1564), pero no tienen escala. |
| z-index | 12 valores (`z-10…z-[9999]`) | Sin escala, los menús a veces quedan debajo de las hojas. |

### 1.3 Movimiento

| Qué | Hoy |
|---|---|
| Fondos de modal (`animate-velo`) | 82 ✅ |
| Contenido que aparece (`animate-aparece`) | 6 |
| Cambio de página/pestaña (`animate-pagina`) | 5 |
| Diálogos (`animate-dialogo`) y hojas (`.hoja`) | 3 + todas las `.hoja` |
| Acordeones y desplegables (`aria-expanded`) | 14 en 8 archivos; **solo 2** abren animados (parciales). |
| Menús emergentes (popover) | 8; **solo 1** animado. |
| `duration-200` crudo vs tokens (`duration-estandar`…) | 25 crudos, 2 con token. |
| `transition-all` (costoso y anima de más) | 16 |
| Microanimaciones de ícono | Solo chevrones que giran (11 archivos). |

### 1.4 Tamaño de archivos (riesgo de migración)

`SubjectPage` 9 757 · `ActivityPage` 3 098 · `CalendarPage` 2 845 ·
`EvaluacionManager` 2 770 · `EvaluacionEditor` 2 289 · `PlaneacionInicialSection` 1 470 ·
`student/ActivityPage` 1 373 · `student/SubjectPage` 1 145 · `EFDateTimePicker` 1 142 ·
`EntregableEditor` 1 064 (192 archivos `.jsx` en total).

---

## 2. El contrato: escalas y reglas

Lo que sigue se vuelve norma en `docs/DESIGN_SYSTEM.md` y se implementa como
**tokens**, no como clases sueltas. La raíz es 14.4 px (`html { font-size: 90% }`),
así que todas las medidas van en `rem`.

### 2.1 Altura de control: una sola para todo lo que se toca

Botones, campos, selects, buscadores, píldoras de pestaña, chips con acción y
botones de ícono **comparten la misma altura**.

| Token | Escritorio (puntero fino) | Táctil (`pointer: coarse`) | Uso |
|---|---|---|---|
| `--control-sm` | 2.25rem ≈ 32 px | 2.75rem ≈ 40 px | Solo en zonas densas: tablas, barras de herramientas, chips. |
| `--control` (**base**) | 2.75rem ≈ 40 px | 3rem ≈ 43 px | **Todo lo demás.** |
| `--control-lg` | 3.25rem ≈ 47 px | 3.25rem ≈ 47 px | Solo la acción principal de pantallas de acceso y el botón fijo de un formulario. |

- La altura es **fija** (`h-[var(--control)]`), no sale del padding. El padding solo
  da el aire lateral: `px-4` normal, `px-3` en `sm` y `aspect-square` en botones de ícono.
- El texto de control es **siempre `text-sm font-semibold`**: el tamaño de letra deja
  de cambiar la altura.
- En táctil la altura sube sola (media query en `:root`), sin `md:` por pantalla.
  Cubre el objetivo táctil de 44 px.

### 2.2 Forma: tres radios y una regla

| Elemento | Radio |
|---|---|
| Todo control de una línea (botón, campo, select, buscador, chip, pestaña, botón de ícono) | `rounded-full` |
| Fondos de ícono, avatares, muestras de color o ícono, puntos de estado | `rounded-full` (círculo) |
| Tarjetas, hojas, paneles, menús emergentes, cajas agrupadoras | `rounded-card` |
| Áreas de texto de varias líneas, bloques dentro de una tarjeta (esquinas concéntricas) | `rounded` (1rem) |

**Regla:** `rounded` sobre un control de una línea es un error. Hoy hay 151 campos y
unos 99 botones así: son la principal fuente de cosas «redondeadas a medias». Los
candados de `rounded-t/b/l/r` y de radios fuera de escala se quedan como están.

### 2.3 Íconos: de 19 tamaños a 5

| Token | px | Uso | Hoy se mapea desde |
|---|---|---|---|
| `ICONO.xs` | 14 | Dentro de chips y controles `sm` | 11, 12, 13, 14 |
| `ICONO.sm` | 16 | Dentro de botones y junto a texto | 15, 16, 17 |
| `ICONO.md` | 20 | Navegación, fondos de ícono, botones de ícono | 18, 19, 20, 21, 22 |
| `ICONO.lg` | 24 | Encabezados de sección, tarjetas grandes | 24, 26, 28 |
| `ICONO.xl` | 40 | Estados vacíos, ilustración | 32 y mayores |

Todos con el mismo `strokeWidth` (2, el de lucide), y viven en `src/config/iconos.js`.

**Fondos de ícono** (componente `IconTile`), siempre círculo: `sm` 2rem, `md` 2.5rem
(el de las filas de lista) y `lg` 3rem (tarjetas del tablero). Hoy hay cinco tamaños.

### 2.4 Capas (z-index)

Hoy hay 12 valores. Quedan seis tokens en `tailwind.config.js`:
`z-contenido` 10 · `z-barra` 30 · `z-menu` 40 · `z-hoja` 50 · `z-aviso` 60 · `z-tope` 90.
Un menú dentro de una hoja usa `z-menu` *relativo a la hoja* (portal), no un número
mayor.

### 2.5 Movimiento (amplía DESIGN_SYSTEM §6.14)

Personalidad **Corporate** (la actual): firma `cubic-bezier(0.2,0,0,1)`, entrada
`(0.05,0.7,0.1,1)`, salida `(0.3,0,1,1)`. Duraciones:

| Token | ms | Uso |
|---|---|---|
| `rapida` | 150 | Hover, presión, cambio de color, íconos |
| `estandar` | 250 | Menús, acordeones, pestañas, tarjetas |
| `lenta` | 350 | Hojas, diálogos, páginas |

- Las entradas duran 30–40 % más que las salidas.
- Se anima solo `transform` y `opacity`: nunca `transition-all` ni `height` directo
  (para eso se usa el truco de `grid-rows 0fr→1fr`).
- Con `prefers-reduced-motion` todo queda instantáneo (ya existe globalmente).
- **Sin dependencias nuevas** (nada de framer-motion): todo es CSS más el plugin
  `formaApp`. El arranque acaba de bajar de 1.15 MB a 217 KB y no se vuelve a inflar.

---

## 3. La librería `src/components/ui/` completa (Fase 1)

Cada componente nace con estas cinco cosas:

1. Medidas del contrato.
2. Todos sus estados: normal, hover, presionado, foco, deshabilitado, ocupado, error y seleccionado.
3. Accesibilidad: rol, `aria-*` y teclado.
4. Su animación.
5. Un ejemplo en el catálogo.

| # | Componente | Reemplaza | Notas |
|---|---|---|---|
| 1 | `Button` (ampliar) | 1 079 `<button>` con estilo | Variantes actuales más `size` ligado a `--control`, `icono` a la izquierda y `iconoDer`. |
| 2 | `IconButton` | Botones de ícono sueltos (X, editar, más…) | Círculo de `--control`, `aria-label` obligatorio y tooltip automático. |
| 3 | `Input` (ampliar) | 214 `<input>` y 7 `inputCls` | Píldora, `prefijo`/`sufijo` (ícono o texto) y error en línea. |
| 4 | `Textarea` | 52 `<textarea>` | `rounded`, autoalto opcional y contador. |
| 5 | `Field` | Etiqueta + ayuda + error repetidos | Une `label`, `FieldMark` (obligatorio), ayuda e `aria-describedby`. |
| 6 | `Select` / `OptionSheet` | `<select>` crudos y `MiniSelect` de notificaciones | Hoja en móvil y menú en escritorio, con el elegido marcado. |
| 7 | `Checkbox` (ampliar) y `Radio` / `RadioGroup` | 39 + 23 crudos | Palomita que se dibuja al marcar. |
| 8 | `Switch` | 7 versiones caseras | Perilla con resorte suave y `role="switch"`. |
| 9 | `SegmentedTabs` y `SubTabs` | 5 barras de pestañas | Sale de `perfil/Pestanas.jsx`; la píldora elegida se desliza. |
| 10 | `Chip` / `Badge` | Chips y badges de §6.5 | Altura `--control-sm` cuando tiene acción. |
| 11 | `Card` | Las mil `bg-surface-card rounded-card shadow-card p-*` | `padding` por token y `interactiva` (hover y presión). |
| 12 | `ListRow` | Filas de lista (tablero, ajustes, entregas) | Generaliza `FilaAjuste`: ícono, título, detalle y flecha › o ↗. |
| 13 | `IconTile` | Fondos de ícono `w-8…w-12` | Círculo en tres tamaños. |
| 14 | `SwatchGrid` | `PaletteSelect` / `IconSelect` | Ya usa `REJILLA_MUESTRAS`/`MUESTRA`; se formaliza. |
| 15 | `Modal` / `Sheet` (ampliar) | 42 modales a mano | Encabezado fijo y pie fijo (botón principal siempre visible), tamaños del contrato. |
| 16 | `Popover` / `Menu` | 8 menús emergentes | Crece desde su origen, cierra con Escape o clic fuera, teclado ↑↓. |
| 17 | `Disclosure` / `Accordion` | 14 `aria-expanded` | Animación `grid-rows` (la de los parciales) en un solo lugar. |
| 18 | `Tooltip` | 256 `data-tooltip` y 46 `title=` | Unifica: nada de `title=` (no se ve en táctil ni con teclado). |
| 19 | `Toast` | Ya existe | Solo se alinea al contrato. |
| 20 | `EmptyState` | 19 estados vacíos sueltos | Ícono `xl` en `IconTile`, título, texto y acción. |
| 21 | `Spinner` / `Progress` | 138 `Spinner` | Tamaños del contrato y barra de progreso para subidas. |
| 22 | `Avatar` | Fotos de perfil repetidas | Foto o inicial, tamaños de la escala. |
| 23 | `SearchInput` (alinear) | Ya existe | Pasa a usar `Input`. |
| 24 | `Animado` | — | Envoltorio de microanimaciones de ícono (sección 6). |
| 25 | `Catalogo` | — | Página `/dev/componentes`, **solo en desarrollo** (`import.meta.env.DEV`): todos los componentes en todos sus estados, en docente, alumno y admin, a 375 px y 1280 px. Es la referencia para revisar y para la comparación visual. |

**Regla de extracción:** al migrar se conserva lo que cada pantalla tiene de
propio vía `className`, pero **las medidas no se negocian**. Si una pantalla
«necesita» otra altura, se discute y se agrega al contrato, no se sobreescribe
en la pantalla.

---

## 4. Migración pantalla por pantalla (Fase 2)

Se reutiliza la orquestación validada en `PLAN_COMPONENTIZACION.md` §7:
**cada PR es dueño de archivos disjuntos** y migra todo lo de esos archivos
(botones, campos, modales, pestañas, menús) de una sola vez. Nunca se reparte por
tipo de pieza, porque eso metería tres manos en `SubjectPage` y vuelve el desastre
de las tres soluciones distintas.

Orden, de lo más visto a lo menos visto:

| Ola | Archivos | Por qué en este orden |
|---|---|---|
| 2.1 | Acceso: `Login` ×2, `Register`, `ResetPassword`, `Activation`, `VerifyEmail`, `Onboarding`, `ProtectAccount` | Primera impresión; pocos archivos. Sirve de prueba de la librería. |
| 2.2 | Estructura: `Layout`, `StudentLayout`, `StudentBottomNav`, `AvatarNav`, `config/sidebar.js`, `AdminLayout` | Aparece en todas las pantallas. |
| 2.3 | Tableros: `teacher/Dashboard`, `student/Dashboard`, `Agenda` | La pantalla de llegada. |
| 2.4 | Perfil y ajustes: `Profile` ×2, `NotificationSettings` ×2, `PerfilIA`, `AyudaPage`, `TipsPage`, `MiEspacio` | Ya tienen pestañas nuevas. |
| 2.5 | Asignatura del alumno: `student/SubjectPage`, `student/ActivityPage`, `AsistenciaSemanal` | |
| 2.6 | Asignatura del docente: los archivos que salgan de la Fase 5 (uno por PR) | Es la más grande; va después de dividirla. |
| 2.7 | Actividad del docente: `ActivityPage` dividida, `EntregableEditor`, `VistaPreviaEntrega`, `AttachmentList` | |
| 2.8 | Calendario: `CalendarPage` dividida, `calendar/*`, `EventEditor`, `ProgramarZonaSemanal` | Con su propio §6.12. |
| 2.9 | Evaluaciones y juegos: `EvaluacionManager`, `EvaluacionEditor`, `EvaluacionRunner`, `EvaluacionRevision`, `juego/*` | Un archivo grande por PR. |
| 2.10 | Rúbricas, IA y planeación: `rubrica/*`, `ia/*`, `CrearActividadIAModal`, `CrearEvaluacionIAModal`, `PlaneacionInicialSection`, `ChatAsistente` | |
| 2.11 | Modales sueltos de `components/` y admin (`pages/admin/*`) | El admin al final: lo usa una sola persona. |

**Cada PR de migración cumple esto:**

- Las medidas del contrato, verificadas en el catálogo.
- Su esqueleto se actualiza en el mismo PR, y `check:esqueletos` queda en verde.
- `lint` sin subir respecto al HEAD de la rama.
- Captura antes/después a 375 px y 1280 px en la descripción.
- Los candados de la sección 7 bajan sus presupuestos (nunca suben).

---

## 5. Selección y preselección (Fase 3)

«Preselección» aquí tiene dos sentidos, y el plan cubre los dos.

### 5.1 Que siempre se note qué está elegido: un lenguaje por tipo de control

Hoy «elegido» se pinta de muchas maneras: `bg-accent text-white` (190),
`bg-accent-light` (136), `border-accent` (186), `ring-2` (4) y
`bg-surface-card shadow-card` (27). Quedan **cinco** lenguajes, cada uno para su
caso:

| Control | Elegido se ve así | `aria` |
|---|---|---|
| Pestaña principal (segmentada) | Píldora blanca elevada que **se desliza** entre opciones; ícono en acento | `aria-selected` |
| Subpestaña, chip de filtro | Relleno de acento y texto blanco | `aria-selected` / `aria-pressed` |
| Opción de lista (select, menú, hoja de opciones) | Fondo `accent-tint` y palomita ✓ a la derecha que se dibuja | `aria-selected` |
| Muestra de color o ícono | Aro de 2 px con separación | `aria-pressed` |
| Tarjeta elegible (tipo de actividad, plantilla) | Borde de acento, fondo `accent-tint` y ✓ en la esquina | `aria-pressed` |

Reglas:

- **El estado nunca se comunica solo con color**: siempre va acompañado de forma,
  ícono o peso.
- El elegido **nunca cambia de tamaño** (ya se corrigió en `PaletteSelect`: escalarlo
  descuadraba la rejilla).
- En una barra con desplazamiento, la opción elegida **se lleva a la vista** al
  abrir.

### 5.2 Que los formularios lleguen con valores sensatos

Cada formulario se revisa con estas reglas. Los valores concretos son propuesta y
se validan en el PR de cada pantalla.

1. **Lo obvio ya viene puesto.** Ejemplos por validar:
   - Fecha de hoy en asistencia y en eventos.
   - El parcial abierto en «Nueva actividad».
   - La hora siguiente en punto en un evento nuevo.
   - 3 parciales y el ciclo vigente en «Nueva asignatura».
2. **Se recuerda la última elección de quien usa el formulario** (por ejemplo el tipo
   de actividad que más usa). Va en `localStorage`, envuelto en try/catch, y nunca
   para datos.
3. **Un select nunca está vacío.** Muestra el valor actual o el razonable; ya está
   prohibido el «Seleccionar…» gris.
4. **El foco va al primer campo** al abrir una hoja de formulario, con una
   justificación por `jsx-a11y/no-autofocus`.
5. **Nunca se preselecciona una opción destructiva** (eliminar, quitar acceso,
   descartar), ni algo que cueste créditos de IA.
6. **El botón principal refleja si se puede enviar:** queda deshabilitado con el
   motivo en texto, no solo apagado.

---

## 6. Movimiento y microanimaciones (Fase 4)

### 6.1 Toda aparición se despliega

| Patrón | Animación | Token |
|---|---|---|
| Hoja o diálogo | Ya existe: sube en móvil, crece al 96 % en escritorio | `lenta` |
| Fondo de modal | `velo` (ya existe) | `estandar` |
| Menú emergente | Crece desde su origen (`transform-origin` del lado del botón) con opacidad; al cerrar se encoge más rápido | `estandar` / `rapida` |
| Acordeón | `grid-rows 0fr→1fr` y el chevron gira; el contenido se monta una vez y queda `inert` cerrado (como los parciales) | `estandar` |
| Pestañas | La píldora se desliza a la nueva opción y el contenido entra con `pagina` | `estandar` |
| Listas al cargar | `cascada`, máximo 6 escalonados y 180 ms en total | `estandar` |
| Esqueleto → contenido | Fundido cruzado: sin salto, porque miden lo mismo | `rapida` |
| Aviso (toast) | `aviso` (ya existe) | `estandar` |
| Elemento nuevo en una lista | Entra con `aparece` y se resalta una vez | `estandar` |
| Elemento eliminado | Se encoge (`grid-rows`) y se desvanece antes de salir del DOM | `rapida` |

### 6.2 Microanimaciones de ícono (donde hay interacción)

Solo al interactuar o al ocurrir algo, nunca en bucle (salvo lo que avisa que algo
está en curso). Todo en CSS, con el envoltorio `<Animado tipo="…">` o clases del
plugin `formaApp`.

| Ícono / acción | Microanimación | Dónde |
|---|---|---|
| ＋ Crear | Gira 90° al pasar o presionar | Nueva asignatura, actividad, evento, estudiante |
| › / ⌄ Chevron | Gira al abrir | Acordeones, filas desplegables |
| ✓ Palomita | Trazo que se dibuja | Casillas, guardado con éxito, opción elegida |
| Copiar → ✓ | Cambio con pop | Copiar código o usuario |
| 🔔 Campana | Sacudida de 2 oscilaciones al llegar algo nuevo, una vez | Notificaciones |
| ↻ Actualizar | Un giro al tocar; gira mientras sincroniza | Recargar, reintentar |
| ✨ IA | Destellos mientras genera; brillo suave al pasar | Botones de IA y créditos |
| ⬆︎ / ⬇︎ Subir y descargar | Empujón de 2 px en su dirección | Adjuntos, exportar |
| 🗑 Eliminar | Leve balanceo al pasar (advierte sin asustar) | Botones destructivos |
| 👁 Ver contraseña | Parpadeo al alternar | `PasswordInput` |
| 📷 Foto | Pop de obturador al elegir | Cambiar foto |
| ➤ Enviar | Sale volando al enviar | Avisos, chat, entregar |
| 📅 Hoy | Pulso del punto, una vez | Calendario |
| Interruptor | Perilla con resorte | `Switch` |
| Créditos | Conteo animado al cambiar el saldo | Barra de créditos, perfil |

**Alumno:** mismos tokens, con un poco más de rebote (3–5 %) en los éxitos (entregar,
terminar una evaluación), porque su módulo es más lúdico. Sujeto a decisión, ver la
sección 10.

### 6.3 Reglas de calidad del movimiento

- Con 3 o más elementos, no más de un tercio se mueve a la vez.
- Ninguna animación bloquea la interacción: se puede tocar durante la entrada.
- Todo respeta `prefers-reduced-motion`.
- Nada de `transition-all`.
- Una animación nueva entra al plugin `formaApp` con nombre en español y su uso en
  §6.14. Nunca un `@keyframes` suelto en una pantalla.

---

## 7. Candados nuevos (Fase 6, y cada fase baja su presupuesto)

Se agregan a `scripts/check-ui-standards.sh` como **trinquetes**: presupuesto = conteo
de hoy, y el script falla si sube y avisa para bajarlo cuando baja (igual que
`h-screen` y `w-[px]`).

| # | Candado | Hoy | Meta |
|---|---|---:|---:|
| 1 | Control de una línea con `rounded` (no `-full`) | ~250 | **0** |
| 2 | `<button>` con `bg-accent`, `bg-red-600` o `border-outline-variant` fuera de `ui/` | por medir | 0 |
| 3 | `<input>` / `<textarea>` / `<select>` con estilo fuera de `ui/` | ~280 | 0 (allowlist: `file`, `color`, ocultos) |
| 4 | `size={N}` de ícono fuera de {14, 16, 20, 24, 40} | 19 tamaños | 0 |
| 5 | `duration-NNN` / `ease-[…]` crudos | 26 | 0 |
| 6 | `transition-all` | 16 | 0 |
| 7 | `type="checkbox"` / `type="radio"` fuera de `ui/` | 62 | 0 |
| 8 | `fixed inset-0` fuera de `ui/Modal` y de la allowlist | 42 | ≤ 12 (allowlist de pantallas completas) |
| 9 | z-index fuera de los 6 tokens | 12 valores | 0 |
| 10 | `title="…"` como tooltip | 46 | 0 |
| 11 | `aria-expanded` sin `Disclosure`/`Popover` (sin animación) | 12 | 0 |

Además:

- **ESLint:** `no-restricted-syntax` para avisar de `<button className=…bg-accent…>`
  en archivos nuevos.
- **Esqueletos:** los componentes de `ui/` exportan sus constantes de medida, y los
  esqueletos las importan. Así no pueden desfasarse (es la forma preferida de
  `check:esqueletos`).

---

## 8. Dividir los monolitos (Fase 5, antes de las olas 2.6–2.8)

`SubjectPage` (9 757 líneas) no se puede migrar en un PR revisable. Se divide
primero **sin cambiar nada visual** (PRs de solo mover código):

- **`pages/teacher/subject/`**
  - `SubjectPage.jsx` (orquestador, estado compartido y carga)
  - `EncabezadoAsignatura`
  - `TabActividades`, `TabLista`, `TabAsistencia`, `TabCalificaciones`
  - `TabRecursos`, `TabAvisos`, `TabPlaneacion`
  - `ModalesAsignatura` (los 28 de `hoja`)
- **`pages/teacher/activity/`:** igual con `ActivityPage` (encabezado, entregas,
  calificación, configuración).
- **`pages/teacher/calendar/`:** vistas Año, Mes, Semana y Día, con la barra y el
  editor por separado.

Cada división se verifica así: mismo DOM en las capturas, `check:esqueletos` en verde,
lint igual y navegación completa en el emulador.

---

## 9. Verificación (Fase 6)

1. **Comparación visual automática:** script `npm run test:visual` (Playwright con el
   emulador y `sembrar-docente.cjs`) que fotografía unas 25 pantallas clave y el
   catálogo, a 375 y 1280 px, en docente y alumno. Compara contra la referencia con
   tolerancia. Se corre en local primero y en CI después.
2. **Accesibilidad:** axe sin violaciones nuevas, recorrido completo con teclado y
   objetivos táctiles ≥ 40 px (`--control` en táctil).
3. **Movimiento reducido:** recorrido con `prefers-reduced-motion: reduce` y nada se
   mueve.
4. **Rendimiento:** el paquete inicial no sube de 230 KB comprimido, y no aparecen
   tareas largas nuevas al abrir hojas o pestañas (medido con la misma emulación de
   4G lento y CPU 4x de oct-2026).
5. **App nativa (Capacitor):** pasada en Android con zonas seguras y botón atrás.

---

## 10. Decisiones tomadas (10-oct-2026)

Las cuatro se aprobaron como se recomendaron:

1. **Altura base:** 40 px en compu y 43 px en táctil (`--control`, §2.1).
2. **Alumno:** un poco más de rebote (3–5 %) solo en los éxitos. El docente queda sobrio.
3. **Preselecciones:** se validan en el PR de cada pantalla.
4. **Ejecución:** ola por ola, fusionando a main tras cada PR. Las olas grandes (2.6–2.10) van con agentes en paralelo por archivo.

---

### Escala de letra del docente — decidido (b), 11-oct-2026

En el docente, `text-xs` medía 14.3 px y `text-sm` 12.8 px: la «chica» era más grande que la «normal». Se tomó la opción (b):

- `--fs-xs` del docente bajó a ≈ 12.4 px.
- Los 165 textos de lectura (de 45 caracteres o más) que vivían en `text-xs` pasaron a `text-sm`, en 50 archivos.
- Las pantallas del alumno no se tocaron: su escala no estaba invertida.

Orden resultante: `xs` 12.4 < `sm` 12.8 < `base` 14.6 px.

## 11. Orden de ejecución y entregables

| Paso | PRs | Entregable | Etiqueta de respaldo |
|---|---:|---|---|
| Fase 0 | 1 | Tokens (`--control*`, íconos, `IconTile`, z-index, movimiento) y §2 en DESIGN_SYSTEM | `respaldo-antes-normalizacion` |
| Fase 1 | 3–4 | `ui/` completa y `/dev/componentes` | — |
| Fase 5 | 3 | Monolitos divididos, sin cambio visual | `respaldo-antes-division` |
| Fase 2 | 12–15 | Olas 2.1 a 2.11 | Una por ola |
| Fase 3 | 2–3 | Lenguaje de selección y preselecciones validadas | — |
| Fase 4 | 2–3 | Despliegues y microanimaciones | `respaldo-antes-movimiento` |
| Fase 6 | 2 | Candados al mínimo, comparación visual y QA | — |

La Fase 5 va antes de la ola 2.6 y las fases 3 y 4 se van aplicando **dentro** de cada
ola cuando la pieza ya existe en `ui/`. Las fases 3 y 4 como tales solo cierran lo
que quede transversal.

**Definición de terminado:**

- Todos los candados de la sección 7 en su meta.
- Catálogo completo.
- Comparación visual en verde.
- DESIGN_SYSTEM §4, §6 y §6.14 actualizados.
- Ninguna pantalla con un control que no venga de `ui/`, salvo la allowlist documentada.

---

## 12. Avance (12-oct-2026)

| Fase | Estado | PRs |
|---|---|---|
| 0. Contrato | ✅ | #1566 |
| 1. Librería | ✅ `ui/` completa y `/dev/componentes` | #1567, #1568 |
| 2. Migración | ✅ olas 2.1 a 2.11 | #1569, #1578–#1583 (y escala de letra #1577) |
| 3. Selección y preselección | ⏳ en curso, pantalla por pantalla (ver «Fase 3 — pantallas») | este PR: Nueva asignatura |
| 4. Movimiento | ✅ despliegues y microanimaciones, casillas nativas con aspecto `ui/` y 53 modales a `ui/Modal` | #1584, #1585, #1586 |
| 5. Monolitos | ✅ sin cambio visual (mismo HTML en todas las pestañas) | #1587, #1588 |
| 6. Verificación y candados | ✅ `npm run test:visual` y candados al mínimo | este PR |

Etiquetas de respaldo: `respaldo-antes-normalizacion`, `respaldo-antes-movimiento`
(antes de #1584) y `respaldo-antes-division` (antes de #1587).

### Fase 5 — tamaños

| Archivo | Antes | Después | Piezas nuevas |
|---|---:|---:|---|
| `teacher/SubjectPage.jsx` | 9 529 | 5 098 | `subject/`: `contexto`, `piezas`, `utilidades`, `TabActividades`, `TabCalificaciones`, `TabAsistencia`, `TabLista`, `TabRecursos`, `ModalesAsignatura`, `EditoresAsignatura` |
| `teacher/ActivityPage.jsx` | 3 007 | 1 470 | `activity/`: `ListaEntregas`, `PanelCalificar`, `PanelCalificarMovil`, `contexto`, `piezas`, `utilidades` |
| `teacher/CalendarPage.jsx` | 2 822 | 1 729 | `calendar/`: `piezas` (vistas Año, Mes, Semana, Día), `utilidades` |

Herramientas en `scripts/normalizacion/` (Babel): `mapa.mjs`, `bloques.mjs`,
`dividir.mjs mover|extraer` y `podar.mjs`. Al dividir afloraron 4 avisos del
React Compiler que ya existían, ocultos en el monolito (`Date.now` en el render,
uso antes de declarar, `ref` leído en un handler y `setState` en un efecto). Por
eso el presupuesto de lint quedó en 190.

### Fase 3 — pantallas

El usuario pidió (12-oct-2026) que cada pantalla la valide el propio agente,
cambiando lo menos posible de la interfaz y siguiendo los patrones que ya usa la
app. Cada una se mide con `node scripts/visual/verificar.mjs --vista=<nombre>`.

| Pantalla | Preselección | Selección (§5.1) | Otros |
|---|---|---|---|
| **Nueva asignatura** ✅ | Fechas, parciales y fechas por parcial del **ciclo vigente**: la asignatura activa más reciente cuyo curso no ha terminado, con la nota «Tomadas de «…»». Color: el primero que no usa ninguna asignatura activa, entre los que pasan contraste AA como texto (azul, morado, rosa, grafito). Si no hay de dónde tomarlos, no se inventan (`utils/asignaturaNueva.js`). | Colores, bolitas e íconos marcan lo elegido con el mismo aro de 2 px con separación y `aria-pressed`. Íconos con nombre en español. | Foco en «Asignatura» (solo con mouse). «Crear asignatura» se apaga y dice qué falta. Las fechas fijas por parcial miden lo mismo que el selector de al lado. |

Las muestras de color o ícono (`MUESTRA`, 2.5rem) quedan fuera de la
auditoría de alturas: son celdas de una rejilla documentadas en DESIGN_SYSTEM
§6.7, no controles.

### Fase 6 — verificación

`docs/VERIFICACION_VISUAL.md`. El script compara el HTML de 18 vistas en compu y
en celular contra una referencia local, y audita el contrato de alturas y esquinas.
La auditoría empezó con 34 hallazgos y quedó en **0**, incluidos 6 que solo existen
en el teléfono (el botón «Editar» de la asignatura, y el botón de horas y el
selector de vista del calendario). Esos 6 estaban escondidos porque Chromium
perdía la emulación táctil en cada captura.

No se ejecutaron del §9 la pasada de axe, la de teclado completo ni la de la app
nativa. Quedan para la fase 3, pantalla por pantalla.

### Candados al 12-oct-2026

| # | Candado | Inicio | Hoy |
|---|---|---:|---:|
| 1 | Control con esquina a medias | 218 | 32 |
| 2 | Botón primario a mano | 42 | **0** |
| 4 | Ícono fuera de la escala | 502 | **0** |
| 5 | Duración cruda | 26 | **0** |
| 6 | `transition-all` | 16 | **0** |
| 7 | Casilla u opción a mano (con el aspecto de `ui/` por CSS base) | 62 | 60 |
| 8 | Modales a mano (ahora se cuentan apariciones, no archivos) | 42 archivos | 62 apariciones |
| 9 | `z-[NN]` con número | 49 | 12 |
| — | Lint | 221 | 190 |

Los que no están en 0 son controles con un diseño propio (tarjetas de opción, celdas
de tabla, pantallas completas) que no encajan en una pieza de `ui/` sin cambiar
cómo se ven. Se bajan dentro de la fase 3, cuando se revise cada pantalla.
