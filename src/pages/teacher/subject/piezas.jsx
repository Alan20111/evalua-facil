// Piezas de SubjectPage.jsx que viven fuera del componente principal.
// Salieron tal cual en la fase 5 de PLAN_NORMALIZACION_UI (sin cambio visual).
import { ArrowLeft, CalendarPlus, Check as CheckIcon, ChevronDown, Minus, MoreVertical, X } from 'lucide-react'
import { Button } from '../../../components/ui'
import { ESTADO_FILTRO_OPCIONES, SIN_CALLOUT_IOS, anchoColumnaNombreH, marcaDeTiempo } from './utilidades'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP } from '../../../utils/platform'
import { attendanceState, countPresence, fmtAttDateLong, fmtAttDateParts, fmtAttMonth } from '../../../utils/attendance'
import { createPortal } from 'react-dom'
import { formatShortDate } from '../../../utils/dateRange'
import { llaveCeldaObservacion } from '../../../utils/observacionesBitacora'
import { memo, useEffect, useRef, useState } from 'react'
import { studentFullName } from '../../../utils/studentSearch'
import { useBackHandler } from '../../../hooks/useBackHandler'

export const AttendanceTable = memo(function AttendanceTable({
  attendanceParciales, filteredAttendanceStudents, attendanceAllRecords,
  onCellClick,
  onDeleteDay, onBack, onAddDay, addDayLabel, // addDayLabel null = ya no hace falta (todo automático y sin días faltantes) → botón oculto
  lastEditedCell, // "recordId:studentId" — la última celda revisada/modificada, resaltada de forma persistente
  parcialesFechas, // subject.parcialesFechas — fecha corta bajo "Parcial N", si existe
  totalOficialPorParcial, // subject.totalOficialPorParcial — total oficial capturado por el docente
  sesionesPorParcialCliente, // sesiones calculadas en tiempo real por el cliente (open parcials)
  parcialesCerrados, // subject.parcialesCerrados — marca de cierre por parcial
  umbralInasistencia, // schools.umbralInasistencia — umbral institucional (%)
  // Observaciones del docente por celda (solo variante 'web'; en las demás
  // llega undefined y la tabla queda exactamente igual):
  //  · observaciones      { '{fecha}_{slot}_{studentId}': texto }
  //  · onCellContextMenu  (event, record, student) — clic derecho en una celda
  //  · onNameContextMenu  (event, student) — clic derecho / tecla Menú en el nombre
  observaciones, onCellContextMenu, onNameContextMenu,
  // Qué versión pintar, SIEMPRE explícita:
  //  · 'app'     → vista horizontal de la app nativa (IS_NATIVE_APP), igual que siempre
  //  · 'web'     → escritorio/tablet, igual que siempre
  //  · 'movil-v' → Tomar lista en el teléfono (navegador), vertical
  //  · 'movil-h' → Tomar lista en el teléfono (navegador), horizontal
  // 'app' y 'web' producen exactamente las mismas clases que antes de existir
  // las variantes de teléfono.
  variante,
}) {
  // Nodos DOM cacheados por columna/día para el efecto de cruz (fila+columna)
  // — resaltado con classList directo, sin state ni CSS :has() (ambos
  // resultaron más lentos: state re-renderiza toda la tabla, :has(:hover)
  // obliga al navegador a re-evaluarla completa en cada pixel de movimiento).
  const attColElsRef = useRef(new Map())
  const attDayElRef = useRef(new Map())
  const attLastHoverRef = useRef({ col: null, day: null })
  const attActiveCellRef = useRef(null)

  const esApp = variante === 'app'
  const esMovil = variante === 'movil-v' || variante === 'movil-h'
  // Observaciones en las CUATRO variantes: web de escritorio, tablet, teléfono
  // (web) y app nativa (17-sep-2026, pedido explícito). Con mouse se abren con
  // clic derecho; en pantalla táctil —incluida la app— con pulsación larga.
  const conObservaciones = !!observaciones
  // Globo al pasar el puntero: solo tiene sentido donde puede haber mouse.
  const conGloboObs = conObservaciones && variante === 'web'
  // Versión simplificada (app y teléfono web): sin Totales ni renglón de sesión.
  const esSimple = esApp || esMovil
  // Regresar/ASISTENCIAS/Agregar día en la esquina fija de la tabla. En el
  // teléfono vertical no caben junto al nombre de 130px: van en una barra arriba.
  const conEsquina = esApp || variante === 'movil-h'
  const dayColW = esApp ? 'w-[74px]'   // columnas de asistencia más anchas en la app — pedido explícito, +15% sobre los 64px anteriores
    : variante === 'movil-h' ? 'w-[48px]' // teléfono horizontal: angostas para que quepan más sesiones
    : variante === 'movil-v' ? 'w-[44px]' // teléfono vertical: cómodas para el dedo
    : 'w-9'
  const cellPadY = esApp ? 'py-[4.8px]' : 'py-1' // renglones 20% menos altos que antes (52px→41.6px) sin achicar el ícono de 32px — pedido explícito
  const cellIconSize = esApp || esMovil ? 'w-8 h-8' : 'w-6 h-6' // símbolo más grande en la app, a juego con la celda más ancha
  // Teléfono vertical: 150px y el nombre en hasta dos líneas (sin "…") — con
  // 130px y una sola línea se cortaban 2 de cada 3 nombres largos.
  const nameColW = variante === 'movil-v' ? 'w-[150px]' : 'w-[210px]'
  // Teléfono horizontal: encabezado compacto (parcial, fechas y sesiones en un
  // renglón; fila de días más baja) para que la tabla empiece más arriba.
  const compactaH = variante === 'movil-h'
  const diaPy = compactaH ? 'py-0.5' : 'py-1'
  // Teléfono horizontal: ancho de la columna del nombre según el nombre más
  // largo del grupo (ver anchoColumnaNombreH). Se calcula DURANTE el render, no
  // en un efecto: así el primer commit ya trae el ancho final y el
  // desplazamiento automático hacia HOY (que mide la tabla al entrar) no queda
  // desfasado. Cambia solo cuando cambia la lista. El estado únicamente fuerza
  // a medir de nuevo si la fuente termina de cargar después del primer render.
  const [, setFuenteNombreLista] = useState(0)
  useEffect(() => {
    if (!compactaH || typeof document === 'undefined' || !document.fonts) return undefined
    let vivo = true
    const avisar = () => { if (vivo) setFuenteNombreLista((n) => n + 1) }
    const fuentes = document.fonts
    fuentes.load(`500 13px ${getComputedStyle(document.body).fontFamily}`).then(avisar, () => {})
    fuentes.addEventListener?.('loadingdone', avisar)
    return () => { vivo = false; fuentes.removeEventListener?.('loadingdone', avisar) }
  }, [compactaH])
  const anchoNombreH = compactaH ? anchoColumnaNombreH(filteredAttendanceStudents) : 210
  const estiloNombreH = compactaH ? { width: anchoNombreH } : undefined
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const attColIndexById = {}
  const attColToDay = {}
  let _attCol = 0
  attendanceParciales.forEach((g) => {
    g.days.forEach(({ fecha, records }) => {
      records.forEach((r) => { attColIndexById[r.id] = _attCol; attColToDay[_attCol] = fecha; _attCol++ })
    })
  })
  const addAttColEl = (col) => (el) => {
    if (!el) return
    const arr = attColElsRef.current.get(col) || []
    arr.push(el)
    attColElsRef.current.set(col, arr)
  }
  const setAttDayEl = (fecha) => (el) => { if (el) attDayElRef.current.set(fecha, el) }
  // Globo con el texto de la observación al pasar el puntero por una celda que
  // la tiene — un solo nodo en un portal, manejado por DOM directo (sin state)
  // por la misma razón que el resaltado en cruz: no re-renderizar la tabla.
  // Posición fija, así no lo recortan el scroll ni el encabezado sticky.
  const obsPopRef = useRef(null)
  const obsTimerRef = useRef(null)
  const ocultarObs = () => {
    clearTimeout(obsTimerRef.current)
    obsPopRef.current?.classList.add('hidden')
  }
  const programarObs = (cellEl) => {
    ocultarObs()
    const texto = cellEl?.getAttribute('data-obs')
    if (!texto || !obsPopRef.current) return
    obsTimerRef.current = setTimeout(() => {
      const pop = obsPopRef.current
      if (!pop || !cellEl.isConnected) return
      pop.textContent = texto
      pop.classList.remove('hidden')
      const r = cellEl.getBoundingClientRect()
      const { width, height } = pop.getBoundingClientRect()
      const margen = 8
      const left = Math.max(margen, Math.min(r.left, window.innerWidth - width - margen))
      const top = r.bottom + 4 + height > window.innerHeight - margen ? Math.max(margen, r.top - 4 - height) : r.bottom + 4
      pop.style.left = `${left}px`
      pop.style.top = `${top}px`
    }, 250)
  }
  useEffect(() => {
    if (!conGloboObs) return undefined
    const ocultar = () => { clearTimeout(obsTimerRef.current); obsPopRef.current?.classList.add('hidden') }
    window.addEventListener('scroll', ocultar, true)
    return () => { window.removeEventListener('scroll', ocultar, true); clearTimeout(obsTimerRef.current) }
  }, [conGloboObs])

  // ── Menú de observaciones: clic derecho / teclado / pulsación larga ──────
  // Con mouse o teclado llega el evento `contextmenu` de siempre. En pantalla
  // táctil (teléfono o tablet) se usa una pulsación larga propia de ~500 ms:
  // iPhone no dispara `contextmenu` y Android sí, así que un solo mecanismo
  // se comporta igual en los dos. Se cancela si el dedo se mueve más de ~10 px
  // o si el navegador toma el gesto para desplazarse (pointercancel/scroll).
  // Al dispararse se "traga" el clic que llega al soltar: sin eso, el toque
  // que termina el gesto cambiaría P/F/J o elegiría una opción del menú.
  const punteroRef = useRef('mouse') // último pointerType visto en la tabla
  const pulsacionRef = useRef(null) // { timer, quitar } mientras el dedo espera
  const ultimoToqueRef = useRef(0)
  const cancelarPulsacion = () => {
    const p = pulsacionRef.current
    if (!p) return
    clearTimeout(p.timer)
    p.quitar()
    pulsacionRef.current = null
  }
  const tragarClickAlSoltar = () => {
    const tragar = (ev) => { ev.preventDefault(); ev.stopPropagation(); quitar() }
    const alSoltar = () => setTimeout(quitar, 400)
    const respaldo = setTimeout(() => quitar(), 10000)
    function quitar() {
      clearTimeout(respaldo)
      document.removeEventListener('click', tragar, true)
      window.removeEventListener('pointerup', alSoltar, true)
      window.removeEventListener('pointercancel', alSoltar, true)
    }
    document.addEventListener('click', tragar, true)
    window.addEventListener('pointerup', alSoltar, true)
    window.addEventListener('pointercancel', alSoltar, true)
  }
  const iniciarPulsacion = (e, abrir) => {
    punteroRef.current = e.pointerType
    if (e.pointerType === 'mouse' || !e.isPrimary) return
    cancelarPulsacion()
    ultimoToqueRef.current = marcaDeTiempo()
    const el = e.currentTarget
    const { pointerId, clientX: x0, clientY: y0 } = e
    const mover = (ev) => {
      if (ev.pointerId === pointerId && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancelarPulsacion()
    }
    const soltar = (ev) => { if (ev.pointerId === pointerId) cancelarPulsacion() }
    window.addEventListener('pointermove', mover, true)
    window.addEventListener('pointerup', soltar, true)
    window.addEventListener('pointercancel', soltar, true)
    window.addEventListener('scroll', cancelarPulsacion, true)
    const quitar = () => {
      window.removeEventListener('pointermove', mover, true)
      window.removeEventListener('pointerup', soltar, true)
      window.removeEventListener('pointercancel', soltar, true)
      window.removeEventListener('scroll', cancelarPulsacion, true)
    }
    const timer = setTimeout(() => {
      cancelarPulsacion()
      tragarClickAlSoltar()
      try { navigator.vibrate?.(15) } catch { /* sin vibración disponible */ }
      abrir({ x: x0, y: y0, trigger: el, tactil: true })
    }, 500)
    pulsacionRef.current = { timer, quitar }
  }
  useEffect(() => () => {
    const p = pulsacionRef.current
    if (p) { clearTimeout(p.timer); p.quitar() }
  }, [])
  // `contextmenu`: con mouse abre el menú junto al puntero; desde el teclado
  // (Shift+F10 / tecla Menú, sin coordenadas) lo abre bajo el elemento. Si
  // viene de un toque (Android lo dispara con la pulsación larga) solo se
  // bloquea el menú nativo: la pulsación larga propia es la que abre.
  const alContextMenu = (e, abrir) => {
    e.preventDefault()
    if (conGloboObs) ocultarObs()
    if (pulsacionRef.current || (punteroRef.current !== 'mouse' && marcaDeTiempo() - ultimoToqueRef.current < 1500)) return
    const r = e.currentTarget.getBoundingClientRect()
    const teclado = !e.clientX && !e.clientY
    abrir({ x: teclado ? r.left + 8 : e.clientX, y: teclado ? r.bottom : e.clientY, trigger: e.currentTarget, tactil: false })
  }

  const clearAttHighlight = () => {
    if (conGloboObs) ocultarObs()
    const { col, day } = attLastHoverRef.current
    if (col != null) (attColElsRef.current.get(col) || []).forEach((el) => el.classList.remove('att-col-hover'))
    if (day != null) attDayElRef.current.get(day)?.classList.remove('att-day-hover')
    attActiveCellRef.current?.classList.remove('att-cell-active')
    attActiveCellRef.current = null
    attLastHoverRef.current = { col: null, day: null }
  }
  // La celda exacta (fila+columna) se rastrea por identidad de nodo, no solo
  // por columna, para que el resaltado "fuerte" se mueva también al cambiar
  // de fila dentro de la misma columna.
  const handleAttHover = (e) => {
    const cellEl = e.target.closest('[data-col]')
    if (cellEl === attActiveCellRef.current) return
    const col = cellEl ? Number(cellEl.getAttribute('data-col')) : null
    if (col !== attLastHoverRef.current.col) {
      if (attLastHoverRef.current.col != null) (attColElsRef.current.get(attLastHoverRef.current.col) || []).forEach((el) => el.classList.remove('att-col-hover'))
      if (attLastHoverRef.current.day != null) attDayElRef.current.get(attLastHoverRef.current.day)?.classList.remove('att-day-hover')
      const day = col != null ? (attColToDay[col] ?? null) : null
      if (col != null) (attColElsRef.current.get(col) || []).forEach((el) => el.classList.add('att-col-hover'))
      if (day != null) attDayElRef.current.get(day)?.classList.add('att-day-hover')
      attLastHoverRef.current = { col, day }
    }
    attActiveCellRef.current?.classList.remove('att-cell-active')
    attActiveCellRef.current = cellEl?.classList.contains('att-cell') ? cellEl : null
    attActiveCellRef.current?.classList.add('att-cell-active')
    // Solo con mouse real: tras un toque el navegador simula un mouseover.
    if (conGloboObs && e.type === 'mouseover' && punteroRef.current === 'mouse') programarObs(attActiveCellRef.current)
  }

  // Precalienta el hover: recorre cada columna/día en tiempo ocioso
  // (add+remove inmediato, invisible) para que el navegador ya haya resuelto
  // estilo/paint de esas celdas ANTES de que el docente mueva el mouse de
  // verdad — si no, cada columna nueva paga ese costo la primera vez que se
  // toca en vivo, sintiéndose como una pausa a mitad del recorrido.
  useEffect(() => {
    const warmUp = () => {
      attColElsRef.current.forEach((els) => {
        els.forEach((el) => { el.classList.add('att-col-hover'); el.classList.remove('att-col-hover') })
      })
      attDayElRef.current.forEach((el) => { el.classList.add('att-day-hover'); el.classList.remove('att-day-hover') })
    }
    const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 200)
    const cic = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout
    const id = ric(warmUp)
    return () => cic(id)
  }, [attendanceParciales, filteredAttendanceStudents])

  // Denominadores por parcial calculados UNA VEZ — son propiedades de la asignatura,
  // no del alumno, así que no tiene sentido recalcularlos dentro del map de estudiantes.
  const denPorParcial = Object.fromEntries(
    attendanceParciales.map((g) => {
      const p = String(g.parcial)
      const den = parcialesCerrados?.[g.parcial]
        ? (totalOficialPorParcial?.[p] ?? null)
        : (sesionesPorParcialCliente?.[p] ?? null)
      return [g.parcial, den]
    })
  )
  // Denominador total = suma de parciales solo si TODOS tienen denominador conocido.
  const denTotal = attendanceParciales.length > 0 && attendanceParciales.every((g) => denPorParcial[g.parcial] != null)
    ? attendanceParciales.reduce((sum, g) => sum + denPorParcial[g.parcial], 0)
    : null

  const tabla = (
  <table onMouseOver={handleAttHover} onFocus={handleAttHover} onMouseLeave={clearAttHighlight}
    // Observaciones: saber si el puntero es mouse o táctil (globo solo con mouse).
    {...(conObservaciones ? { onPointerOver: (e) => { punteroRef.current = e.pointerType } } : {})}
    // Teléfono (web): ancho explícito. `table-fixed` solo respeta los anchos de
    // <col> si la tabla tiene ancho propio; con `auto` el navegador los
    // redistribuía (medido en 360px: nombre 150 en vez de 130, celdas 33 en vez
    // de 44). Nº (w-8) + nombre + sesiones + 2 columnas de resumen (w-10) por
    // parcial. En 'app' y 'web' no se agrega nada.
    style={esMovil ? { width: `calc(2rem + ${variante === 'movil-v' ? 150 : anchoNombreH}px + ${_attCol * (variante === 'movil-v' ? 44 : 48)}px + ${attendanceParciales.length * 5}rem)` } : undefined}
    className={`${esSimple ? 'text-[11px]' : 'text-xs'} border-collapse table-fixed`}>
    <colgroup>
      <col className="w-8" />
      <col className={nameColW} style={estiloNombreH} />
      {attendanceParciales.flatMap((g) => [
        ...g.days.flatMap(({ records }) => records.map((r) => <col key={r.id} className={dayColW} />)),
        <col key={`ca-${g.parcial}`} className="w-10" />,
        <col key={`ci-${g.parcial}`} className="w-10" />,
      ])}
      {!esSimple && <col className="w-10" />}
      {!esSimple && <col className="w-10" />}
    </colgroup>
    <thead className="sticky top-0 z-30 bg-accent-light">
      {/* Fila de parcial — nivel superior, abarca sus días + su resumen */}
      <tr className="bg-accent-light border-b border-outline-variant">
        {conEsquina ? (
          /* Esquina fija: Regresar + ASISTENCIAS + Agregar día en UNA sola celda
             (sin línea divisoria), para darle más ancho al botón de regresar. */
          <th colSpan={2} rowSpan={2} className="sticky left-0 z-30 bg-accent-light px-2 align-middle border-r border-outline-variant">
            <div className="flex items-center gap-2">
              {/* Verde fosforescente con flecha negra — que se note dónde se
                  regresa (pedido explícito) */}
              <button type="button" onClick={onBack} aria-label="Regresar"
                className="flex-none px-2.5 py-1 -ml-1 rounded bg-[#39FF14] text-black hover:bg-[#2ee510] transition-colors">
                <ArrowLeft size={ICONO.md} />
              </button>
              <span className="text-xs font-bold text-on-surface uppercase tracking-wide">Asistencias</span>
              {addDayLabel && (
                <Button size="sm" icon={CalendarPlus} className="ml-auto" onClick={onAddDay}>
                  {addDayLabel}
                </Button>
              )}
            </div>
          </th>
        ) : (
          <>
            <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant" />
            <th className={`sticky left-8 z-20 bg-accent-light ${nameColW} px-2 py-1 border-r border-outline-variant`} />
          </>
        )}
        {/* Encabezado del parcial en DOS renglones (17-sep-2026):
              PARCIAL 1 · (31/08/26–16/10/26)
              Sesiones del periodo: 47
            Antes eran tres y la fecha y las sesiones iban en 9-10px. El ancho
            de esta celda es (sesiones × ancho de columna) + 80px de las dos de
            resumen: con un parcial normal sobra espacio de sobra para juntar
            nombre y fecha en el primer renglón, y así el texto puede crecer.
            Medido con la fuente real: el primer renglón pide ~197px, o sea que
            cabe desde 4 sesiones en la web, 3 en el teléfono y 2 en la app.
            Con MENOS sesiones el renglón simplemente se parte (flex-wrap): no
            se fuerza `nowrap`, que con `table-fixed` desbordaría sobre el
            encabezado vecino. El teléfono horizontal (compactaH) NO cambia:
            ahí ya era un solo renglón y así se queda. */}
        {attendanceParciales.map((g) => {
          const rango = parcialesFechas?.[g.parcial - 1]
          const textoRango = rango ? `(${formatShortDate(rango.inicio)}–${formatShortDate(rango.fin)})` : null
          return (
          <th key={g.parcial} colSpan={g.slotCount + 2}
            className={compactaH
              ? 'px-1 py-1 font-bold text-accent text-center text-[11px] uppercase tracking-wide border-l-2 border-outline whitespace-nowrap'
              : 'px-1 py-1 font-bold text-accent text-center text-base uppercase tracking-wide border-l-2 border-outline'}>
            {compactaH ? (
              <>
                Parcial {g.parcial}
                {textoRango && (
                  <span className="ml-1 text-[9px] font-normal text-hint normal-case tabular-nums">{textoRango}</span>
                )}
              </>
            ) : (
              <span className="flex flex-wrap items-baseline justify-center gap-x-1.5 leading-tight">
                <span>Parcial {g.parcial}</span>
                {textoRango && (
                  <span className="text-sm font-normal text-hint normal-case tabular-nums whitespace-nowrap">
                    <span aria-hidden="true">· </span>{textoRango}
                  </span>
                )}
              </span>
            )}
            {(() => {
              const cerrado = !!parcialesCerrados?.[g.parcial]
              const p = String(g.parcial)
              const sesiones = cerrado
                ? (totalOficialPorParcial?.[p] ?? null)
                : (sesionesPorParcialCliente?.[p] ?? null)
              if (sesiones == null) return null
              return (
                <span className={`${compactaH ? 'inline-flex items-center gap-1 ml-1.5' : 'flex items-center justify-center gap-1 mt-0.5'} normal-case font-normal`}>
                  <span className={`${compactaH ? 'text-[9px]' : 'text-base'} text-muted whitespace-nowrap`}>
                    {cerrado ? '🔒 Sesiones oficiales:' : 'Sesiones del periodo:'}
                  </span>
                  <span className={`${compactaH ? 'text-[10px]' : 'text-base'} font-semibold text-on-surface tabular-nums`}>{sesiones}</span>
                </span>
              )
            })()}
          </th>
          )
        })}
        {!esSimple && (
          <th colSpan={2}
            className="px-1 py-1 font-bold text-accent text-center text-[11px] uppercase tracking-wide border-l-2 border-outline whitespace-nowrap">
            Totales
          </th>
        )}
      </tr>
      {/* Fila de mes — celda "Mes Año" que abarca sus días */}
      <tr className="bg-accent-light/70 border-b border-outline-variant">
        {!conEsquina && (
          <>
            <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant" />
            <th className={`sticky left-8 z-20 bg-accent-light ${nameColW} px-2 py-1 border-r border-outline-variant`} />
          </>
        )}
        {attendanceParciales.flatMap((g) => [
          ...g.months.map((mo) => (
            <th key={`m-${g.parcial}-${mo.ym}`} colSpan={mo.days.reduce((n, d) => n + d.records.length, 0)}
              className="px-1 py-0.5 font-semibold text-accent text-center text-[10px] border-l border-outline-variant whitespace-nowrap">
              {fmtAttMonth(mo.ym)}
            </th>
          )),
          <th key={`res-${g.parcial}`} colSpan={2}
            className="px-0.5 py-0.5 text-center text-[9px] font-semibold text-muted uppercase border-l-2 border-outline">
            Resumen
          </th>,
        ])}
        {!esSimple && <th colSpan={2} className="border-l-2 border-outline" />}
      </tr>
      {/* Fila de día — número de cada día + encabezados de las columnas de conteo */}
      <tr className="bg-accent-light/60 border-b border-outline-variant">
        <th className={`sticky left-0 z-10 bg-accent-light w-8 px-1 ${diaPy} border-r border-outline-variant`} />
        <th style={estiloNombreH} className={`sticky left-8 z-20 bg-accent-light ${nameColW} px-2 ${diaPy} ${esSimple ? 'text-left' : 'text-right'} text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant truncate`}>
          {esSimple ? 'Estudiante / Día:' : 'Día:'}
        </th>
        {attendanceParciales.flatMap((g) => [
          ...g.days.map(({ fecha, records, sinAsistencia }) => {
            const { dia, mes, anio } = fmtAttDateParts(fecha)
            // Día de asueto/vacaciones sin sesión registrada: columna solo
            // informativa — identificada por color y tooltip, sin "Eliminar".
            if (sinAsistencia) {
              const vac = sinAsistencia === 'vacaciones'
              const etiqueta = vac ? 'Periodo vacacional' : 'Día de asueto'
              return (
                <th key={fecha} colSpan={records.length}
                  ref={setAttDayEl(fecha)}
                  data-tooltip={`${etiqueta} (${esSimple ? `${dia}/${mes}/${anio}` : fmtAttDateLong(fecha)}): no se registra asistencia`}
                  aria-label={`${etiqueta}: no se registra asistencia`}
                  className={`px-0.5 ${diaPy} font-semibold text-center border-l border-outline-variant tabular-nums cursor-default ${vac ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                  {dia}
                  <span className="block text-[8px] font-bold uppercase leading-none tracking-tight">{vac ? 'Vac.' : 'Asueto'}</span>
                </th>
              )
            }
            return (
              <th key={fecha} colSpan={records.length}
                ref={setAttDayEl(fecha)}
                onClick={() => onDeleteDay(fecha)}
                data-tooltip={esSimple
                  ? `Eliminar la asistencia del ${dia}/${mes}/${anio}`
                  : `Eliminar la asistencia del ${fmtAttDateLong(fecha)}`}
                className={`px-0.5 ${diaPy} font-semibold text-center border-l border-outline-variant cursor-pointer transition-colors tabular-nums ${fecha === todayISO ? 'bg-accent text-white' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
                {dia}
              </th>
            )
          }),
          <th key={`ha-${g.parcial}`} data-tooltip="Asistencias del parcial"
            className={`px-0.5 ${diaPy} text-center border-l-2 border-outline`}>
            <CheckIcon size={ICONO.xs} className="inline text-green-600" />
          </th>,
          <th key={`hi-${g.parcial}`} data-tooltip="Faltas del parcial"
            className={`px-0.5 ${diaPy} text-center`}>
            <X size={ICONO.xs} className="inline text-red-500" />
          </th>,
        ])}
        {!esSimple && (
          <>
            <th data-tooltip="Total de asistencias" className="px-0.5 py-1 text-center border-l-2 border-outline">
              <CheckIcon size={ICONO.xs} className="inline text-green-600" />
            </th>
            <th data-tooltip="Total de faltas" className="px-0.5 py-1 text-center">
              <X size={ICONO.xs} className="inline text-red-500" />
            </th>
          </>
        )}
      </tr>
      {/* Renglón de sesión — solo web; en la app se oculta para ganar espacio.
          La etiqueta "Estudiante" pasa al renglón de Día (Estudiante / Día:). */}
      {!esSimple && (
        <tr className="bg-accent-light/50 border-b border-outline-variant">
          <th className="sticky left-0 z-10 bg-accent-light w-8 border-r border-outline-variant" />
          <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-0.5 text-left text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant truncate">
            Estudiante / Número de la sesión
          </th>
          {attendanceParciales.flatMap((g) => [
            ...g.days.flatMap(({ fecha, records, sinAsistencia }) => records.map((r) => (
              <th key={r.id} data-col={attColIndexById[r.id]} ref={addAttColEl(attColIndexById[r.id])} className={`w-9 px-0.5 py-0.5 text-center text-[10px] font-medium text-muted border-l border-outline-variant ${sinAsistencia ? (sinAsistencia === 'vacaciones' ? 'bg-purple-50' : 'bg-amber-50') : fecha === todayISO ? 'bg-accent-light' : ''}`}>
                {records.length > 1 ? r.slot : ''}
              </th>
            ))),
            <th key={`sa-${g.parcial}`} className="border-l-2 border-outline" />,
            <th key={`si-${g.parcial}`} />,
          ])}
          <th className="border-l-2 border-outline" />
          <th />
        </tr>
      )}
    </thead>
    <tbody>
      {filteredAttendanceStudents.map((s, i) => {
        const total = countPresence(attendanceAllRecords, s.id, null, todayISO)
        return (
        <tr key={s.id} className={`group border-t border-outline-variant transition-colors duration-estandar hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? '' : 'bg-slate-50'}`}>
          <td className={`sticky left-0 z-10 w-8 px-1 py-1 text-center text-hint border-r border-outline-variant transition-colors duration-estandar group-hover:bg-[var(--accent-tint-solid)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50'}`}>
            {s.orden}
          </td>
          <td style={estiloNombreH} className={`sticky left-8 z-10 ${nameColW} px-2 py-1 ${compactaH ? 'text-[13px]' : esSimple ? 'text-[12px]' : 'text-sm'} font-medium text-on-surface border-r border-outline-variant ${variante === 'movil-v' ? 'break-words' : compactaH ? 'whitespace-nowrap' : 'truncate'} transition-colors duration-estandar group-hover:bg-[var(--accent-tint-solid)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50'}${conObservaciones ? (esMovil ? ' select-none' : ' [@media(pointer:coarse)]:select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent') : ''}`}
            // "Ver bitácora": clic derecho, pulsación larga (táctil) y, en la
            // web, también teclado — el nombre recibe foco (una parada de Tab
            // por estudiante) y abre el menú con la tecla Menú o Shift+F10.
            {...(conObservaciones ? {
              style: { ...estiloNombreH, WebkitTouchCallout: 'none' },
              'aria-haspopup': 'menu',
              onContextMenu: (e) => alContextMenu(e, (info) => onNameContextMenu(info, s)),
              onPointerDown: (e) => iniciarPulsacion(e, (info) => onNameContextMenu(info, s)),
              ...(variante === 'web' ? {
                tabIndex: 0,
                onKeyDown: (e) => {
                  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  onNameContextMenu({ x: r.left + 8, y: r.bottom, trigger: e.currentTarget, tactil: false }, s)
                },
              } : {}),
            } : {})}>
            {studentFullName(s)}
          </td>
          {attendanceParciales.flatMap((g) => {
            const { asist, inasist } = countPresence(g.records, s.id, null, todayISO)
            const denominador = denPorParcial[g.parcial]
            const pctAsist    = denominador > 0 ? (asist   / denominador * 100) : null
            const pctInasist  = denominador > 0 ? (inasist / denominador * 100) : null
            const riesgo = pctInasist == null ? null
              : pctInasist >= (umbralInasistencia ?? 20) ? '🔴'
              : pctInasist >= (umbralInasistencia ?? 20) * 0.75 ? '🟠'
              : '🟢'
            return [
              ...g.days.flatMap(({ fecha, records, sinAsistencia }) => records.map((r) => {
                // Columna informativa de asueto/vacaciones: "—", sin clic y
                // sin clase att-cell (no se marca como celda activa). No hay
                // documento detrás, así que tampoco hay nada que sumar.
                if (sinAsistencia) {
                  const vac = sinAsistencia === 'vacaciones'
                  return (
                    <td key={r.id}
                      data-col={attColIndexById[r.id]}
                      ref={addAttColEl(attColIndexById[r.id])}
                      aria-disabled="true"
                      title={vac ? 'Periodo vacacional: no se registra asistencia' : 'Día de asueto: no se registra asistencia'}
                      className={`${dayColW} px-0.5 ${cellPadY} text-center border-l border-outline-variant select-none cursor-not-allowed ${vac ? 'bg-purple-50/70' : 'bg-amber-50/70'}`}>
                      <span className={`inline-flex items-center justify-center ${cellIconSize} text-hint text-[13px] font-semibold leading-none`}>—</span>
                    </td>
                  )
                }
                const esFuturo = fecha > todayISO
                // Sesiones futuras son slots PROGRAMADOS, no asistencias realizadas.
                // Mostrar ícono neutro (—) en vez de ✔️/❌ para evitar estados
                // de asistencia falsos. countPresence ya excluye futuras del conteo.
                // Sin registro (null): el estudiante se dio de alta después de
                // creada la columna y no tiene llave — mismo ícono neutro, no
                // es falta ni asistencia y no cuenta. Tocarla sí lo registra.
                const estado = esFuturo ? null : attendanceState(r, s.id)
                const sinRegistro = !esFuturo && estado == null
                const motivo = estado === 'justificada' ? (r.motivos?.[s.id] || '') : ''
                const observacion = conObservaciones ? (observaciones[llaveCeldaObservacion(fecha, r.slot, s.id)] || '') : ''
                const ui = estado == null
                  ? { cls: 'bg-slate-100 text-hint', icon: <Minus size={ICONO.xs} /> }
                  : {
                      presente: { cls: 'bg-green-100 text-green-600', icon: <CheckIcon size={ICONO.xs} /> },
                      falta: { cls: 'bg-red-100 text-red-500', icon: <X size={ICONO.xs} /> },
                      justificada: { cls: 'bg-amber-100 text-amber-600', icon: <span className="text-[12px] font-bold leading-none">J</span> },
                    }[estado]
                return (
                  <td key={r.id}
                    data-col={attColIndexById[r.id]}
                    ref={addAttColEl(attColIndexById[r.id])}
                    onClick={() => onCellClick(r, s)}
                    // Observación: clic derecho con mouse, pulsación larga en
                    // táctil. El toque corto sigue siendo P/F/J. Con mouse el
                    // texto se lee al pasar el puntero.
                    // TAMBIÉN en sesiones futuras (17-sep-2026): una observación
                    // es una nota escrita, no una marca de asistencia — no toca
                    // P/F/J ni ningún conteo, así que la fecha no la bloquea.
                    // Antes se excluían y el docente solo veía el menú del
                    // navegador, como si la función estuviera rota. Las columnas
                    // informativas (asueto/vacaciones) siguen SIN menú: se pintan
                    // en la rama de arriba y no son una sesión real.
                    onContextMenu={conObservaciones ? (e) => alContextMenu(e, (info) => onCellContextMenu(info, r, s)) : undefined}
                    onPointerDown={conObservaciones ? (e) => iniciarPulsacion(e, (info) => onCellContextMenu(info, r, s)) : undefined}
                    style={conObservaciones ? SIN_CALLOUT_IOS : undefined}
                    data-obs={observacion || undefined}
                    title={sinRegistro && !observacion ? 'Sin registro: el estudiante aún no estaba en la lista de esta sesión. No cuenta como falta.' : undefined}
                    className={`att-cell ${observacion ? 'relative ' : ''}${dayColW} px-0.5 ${cellPadY} text-center border-l border-outline-variant select-none ${esFuturo ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${lastEditedCell === `${r.id}:${s.id}` ? 'ring-2 ring-inset ring-accent bg-[var(--accent-medium)]' : fecha === todayISO ? 'bg-accent-light' : ''}`}>
                    <span className={`relative inline-flex items-center justify-center ${cellIconSize} rounded ${ui.cls}`}>
                      {ui.icon}
                      {motivo && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </span>
                    {observacion && (
                      /* Indicador de observación: esquina superior IZQUIERDA
                         (la derecha ya la usa el punto de la justificación). */
                      <span aria-hidden="true" className="absolute top-0 left-0 w-2 h-2 bg-accent pointer-events-none"
                        style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                    )}
                  </td>
                )
              })),
              <td key={`a-${g.parcial}`} className="px-0.5 py-1 text-center font-semibold text-green-600 tabular-nums bg-green-50 border-l-2 border-outline">
                {asist}
                {pctAsist != null && <span className="block text-[9px] font-normal text-green-500 leading-none mt-0.5 tabular-nums">{pctAsist.toFixed(1)}%</span>}
              </td>,
              <td key={`i-${g.parcial}`} className="px-0.5 py-1 text-center tabular-nums bg-red-50">
                <span className="font-semibold text-red-500">{inasist}</span>
                {pctInasist != null && <span className="block text-[9px] font-normal text-red-400 leading-none mt-0.5 tabular-nums">{pctInasist.toFixed(1)}%</span>}
                {riesgo && <span className="block text-[9px] leading-none mt-0.5">{riesgo}</span>}
              </td>,
            ]
          })}
          {!esSimple && (() => {
            const pctAsistTot  = denTotal > 0 ? (total.asist   / denTotal * 100) : null
            const pctInasistTot = denTotal > 0 ? (total.inasist / denTotal * 100) : null
            return (
              <>
                <td className="px-0.5 py-1 text-center font-bold text-green-600 tabular-nums bg-green-100/60 border-l-2 border-outline">
                  {total.asist}
                  {pctAsistTot != null && <span className="block text-[9px] font-normal text-green-500 leading-none mt-0.5 tabular-nums">{pctAsistTot.toFixed(1)}%</span>}
                </td>
                <td className="px-0.5 py-1 text-center font-bold text-red-500 tabular-nums bg-red-100/60">
                  {total.inasist}
                  {pctInasistTot != null && <span className="block text-[9px] font-normal text-red-400 leading-none mt-0.5 tabular-nums">{pctInasistTot.toFixed(1)}%</span>}
                </td>
              </>
            )
          })()}
        </tr>
        )
      })}
    </tbody>
  </table>
  )
  if (!conGloboObs) return tabla
  return (
    <>
      {tabla}
      {createPortal(
        <div ref={obsPopRef} role="tooltip"
          className="hidden fixed z-[94] max-w-xs px-3 py-2 bg-surface-card text-on-surface text-xs leading-snug whitespace-pre-wrap break-words border border-outline-variant rounded shadow-lg pointer-events-none" />,
        document.body,
      )}
    </>
  )
})

// Botón partido "Excel/PDF" + ⋮ para exportar por parcial — rehecho desde
// cero. La versión anterior cerraba el menú con un botón invisible
// `fixed inset-0` puesto encima de TODA la pantalla al abrirse, compitiendo
// por el mismo gesto de clic que lo abría; reportado en producción como "no
// hace nada" sin ningún error en consola, y no se pudo reproducir de forma
// consistente para aislar la causa exacta. Ahora cada botón maneja su propio
// estado y usa el patrón estándar de "clic afuera cierra": un listener de
// `mousedown` en `document` que solo se instala mientras el menú está
// abierto y revisa si el clic cayó fuera de su propia caja — sin ningún
// elemento de pantalla completa de por medio.
export function ExportSplitButton({ label, Icon, onMain, mainDisabled, mainTooltip, menuTooltip, menuLabel, parciales, onPickParcial }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocMouseDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    // capture:true — se entera del clic ANTES de que otro handler en el
    // camino (p. ej. otro menú cerrándose) pueda detener su propagación.
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [open])

  useBackHandler(() => setOpen(false), open)

  return (
    <div ref={boxRef} className="flex-1 min-w-0 relative flex">
      <Button variant="outline-accent" icon={Icon} busy={mainDisabled} className="flex-1"
        onClick={onMain}
        disabled={mainDisabled}
        data-tooltip={mainTooltip}>
         {label}
      </Button>
      <Button variant="outline-accent" icon={MoreVertical} className="ml-1 !px-0 aspect-square"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} por parcial`}
        aria-expanded={open}
        data-tooltip={menuTooltip}></Button>
      {open && (
        <div className="absolute z-40 top-full mt-1 right-0 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden animate-menu origin-top-right motion-reduce:animate-none">
          <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">{menuLabel}</div>
          {parciales.map((p) => (
            <button key={p} type="button"
              onClick={() => { setOpen(false); onPickParcial(p) }}
              className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors">
              Parcial {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function EstadoFiltroHeader({ value, onChange, open, setOpen, total, activos }) {
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocMouseDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [open, setOpen])

  useBackHandler(() => setOpen(false), open)

  const current = ESTADO_FILTRO_OPCIONES.find((o) => o.value === value)
  // Cuenta de cada opción sobre el TOTAL de la asignatura, no sobre lo ya
  // filtrado por búsqueda — para que el número diga "de cuántos en total",
  // no "de cuántos me quedan visibles ahora".
  const CONTEO = { todos: total, activo: activos, sin_activar: total - activos }

  return (
    <div ref={boxRef} className={`relative flex-shrink-0 ${IS_NATIVE_APP ? 'w-14' : 'w-24'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Filtrar por estado"
        className={`w-full flex items-center gap-0.5 font-semibold uppercase tracking-wide transition-colors ${
          value !== 'todos' ? 'text-accent' : 'text-muted hover:text-on-surface'
        } ${IS_NATIVE_APP ? 'text-[9px]' : 'text-xs'}`}
      >
        <span className="truncate">{IS_NATIVE_APP ? 'Estado' : current.label === 'Todos' ? 'Estado' : current.label}</span>
        <ChevronDown size={IS_NATIVE_APP ? 10 : 12} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-40 top-full mt-1 left-0 w-36 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden normal-case animate-menu origin-top-left motion-reduce:animate-none">
          {ESTADO_FILTRO_OPCIONES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm transition-colors ${
                o.value === value ? 'bg-[var(--accent-tint)] text-accent font-semibold' : 'text-on-surface hover:bg-[var(--accent-tint)]'
              }`}
            >
              <span>{o.label}</span>
              <span className="text-xs text-muted flex-shrink-0">{CONTEO[o.value]}/{total}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
