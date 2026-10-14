import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { addDoc, writeBatch } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Plus, BookOpen, ChevronRight, X, ArrowUp, ArrowDown, GripVertical, Archive, Globe, Smartphone, Sparkles } from 'lucide-react'
import CanalYouTubeLink from '../../components/CanalYouTubeLink'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPeriodLabel } from '../../utils/dateRange'
import useTelefonoWeb from '../../hooks/useTelefonoWeb'
import PaletteSelect from '../../components/PaletteSelect'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import ParcialesFechas, { normalizeParcialesFechas, addOneDay } from '../../components/ParcialesFechas'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../utils/platform'
import { cicloVigente, paletaLibre } from '../../utils/asignaturaNueva'
import AppQRButton from '../../components/AppQRButton'
import { TEACHER_CONTAINER } from '../../config/layout'
import { teacherDisplayName } from '../../utils/studentSearch'
import { EsqueletoTableroDocente } from '../../components/esqueletos'
import YouTubeIcon from '../../components/YouTubeIcon'
import { Animado, Button, Select, DisclosureCard, FlechaFila, IconButton, IconTile, Input, TARJETA_FILA, Modal, MotivoApagado } from '../../components/ui'
import { ICONO } from '../../config/iconos'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function TeacherDashboard() {
  // Teléfono abierto en el navegador (siempre false en la app).
  const telefonoWeb = useTelefonoWeb()
  const { currentUser, userProfile } = useAuth()
  const location = useLocation()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  // Pedido explícito: en la App (no en la web) se puede tocar la foto del
  // saludo para cambiarla al vuelo, sin entrar al perfil.

  // Modelo de créditos puros (20-ago-2026): crear contenido ya no depende de
  // ninguna suscripción — todo lo no-IA es gratis para cualquier docente.
  const canCreate = true

  // Subject creation modal
  const [showSubjectModal, setShowSubjectModal] = useState(location.state?.openCreate === true)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectGrupo, setNewSubjectGrupo] = useState('')
  // null = sin tocar: el campo muestra lo preseleccionado (fechas y parciales
  // del ciclo vigente, un color que aún no se usa). En cuanto el docente lo
  // cambia, manda su valor (también '' si lo vacía a propósito).
  const [newSubjectParciales, setNewSubjectParciales] = useState(null)
  const [newSubjectPalette, setNewSubjectPalette] = useState(null)
  const [newSubjectIcon, setNewSubjectIcon] = useState('book')
  const [newSubjectFechaInicio, setNewSubjectFechaInicio] = useState(null)
  const [newSubjectFechaFin, setNewSubjectFechaFin] = useState(null)
  const [newSubjectParcialesFechas, setNewSubjectParcialesFechas] = useState(null)
  const [creatingSubject, setCreatingSubject] = useState(false)

  // Preselección (PLAN_NORMALIZACION_UI §5.2). Va antes de los handlers que
  // la usan.
  const ciclo = cicloVigente(subjects)
  const fechaInicio = newSubjectFechaInicio ?? ciclo?.fechaInicio ?? ''
  const fechaFin = newSubjectFechaFin ?? ciclo?.fechaFin ?? ''
  const numParciales = newSubjectParciales ?? (Number(ciclo?.parciales) || 3)
  const fechasDelCiclo = !!ciclo && fechaInicio === ciclo.fechaInicio && fechaFin === ciclo.fechaFin
  const parcialesFechas = newSubjectParcialesFechas
    ?? (fechasDelCiclo && numParciales === Number(ciclo.parciales) ? (ciclo.parcialesFechas || []) : [])
  const palette = newSubjectPalette ?? paletaLibre(subjects)
  // El botón «Crear asignatura» se apaga mientras falte algo, y dice qué.
  const faltan = [
    !newSubjectName.trim() && 'el nombre de la asignatura',
    !newSubjectGrupo.trim() && 'el grupo',
    (!fechaInicio || !fechaFin) && 'las fechas del curso',
  ].filter(Boolean)

  // Archivadas — en la App (sin panel lateral) se agrupan aparte, colapsadas
  // y con sangrado; en la web viven en el panel lateral. En ninguna de las dos
  // se mezclan ya con las asignaturas vivas de la lista principal.
  const [showArchived, setShowArchived] = useState(false)

  const navigate = useNavigate()
  const toast = useToast()

  // Dashboard es raíz (sin flecha "Volver") — el botón físico atrás solo debe
  // cerrar el modal "Nueva asignatura" cuando está abierto; si no hay nada
  // abierto, cae al comportamiento default (doble tap para salir).
  useBackHandler(() => setShowSubjectModal(false), showSubjectModal)
  useScrollLock(showSubjectModal)

  // Datos en vivo — mismo mecanismo (onSnapshot) que usa el sidebar en
  // Layout.jsx, en vez de una carga única propia: antes ambos podían
  // mostrar un orden distinto hasta que se recargaba la página (archivar
  // desde SubjectPage, por ejemplo, actualizaba el sidebar al instante pero
  // el Dashboard se quedaba con la lista vieja hasta el siguiente montaje).
  useEffect(() => {
    if (!currentUser) return
    // Sin setLoading(true) aquí — arranca en true por el useState de arriba
    // (mismo patrón que el sidebar en Layout.jsx); llamarlo de forma
    // síncrona dentro del efecto dispara react-hooks/set-state-in-effect.
    const q = query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        let subList = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Subjects predate manual ordering — the first time we see one without an
        // `orden`, assign one from its current alphabetical position and persist it,
        // so the list has a stable order the teacher can then rearrange by hand.
        if (subList.some((s) => s.orden == null)) {
          subList = subList.sort((a, b) => {
            const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
            if (nc !== 0) return nc
            return (a.grupo || '').localeCompare(b.grupo || '', 'es')
          })
          const batch = writeBatch(db)
          subList = subList.map((s, i) => {
            const orden = i + 1
            if (s.orden !== orden) batch.update(doc(db, 'subjects', s.id), { orden })
            return { ...s, orden }
          })
          batch.commit().catch(() => {}) // best-effort; the in-memory order is already correct
        } else {
          subList = subList.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        }
        setSubjects(subList)
        setLoading(false)
      },
      (err) => { toast('Error al cargar: ' + err.message, 'error'); setLoading(false) }
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  // Open the "Nueva asignatura" modal when navigated here with openCreate — including
  // when ALREADY on /dashboard (sidebar button), where the useState initializer above
  // does not re-run. location.key changes on every navigation, so this fires each time.
  useEffect(() => {
    if (location.state?.openCreate) {
      openSubjectModal()
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  function openSubjectModal() {
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setShowSubjectModal(true)
  }

  // moveSubject/dragPointerUp SÍ hacen su propio setSubjects optimista (para
  // que no haya un parpadeo visible antes de que llegue la confirmación),
  // pero ya no llaman a un loadAll() de respaldo si el commit falla: el
  // listener onSnapshot de arriba es ahora la única fuente de verdad y se
  // vuelve a disparar solo con el estado real en cuanto Firestore resuelve
  // la escritura (exitosa o no).
  async function moveSubject(index, direction) {
    const newList = [...subjects]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newList.length) return
    ;[newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]]
    setSubjects(newList.map((s, i) => ({ ...s, orden: i + 1 })))
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'subjects', s.id), { orden: i + 1 }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  // Reordenar arrastrando — SOLO en la App (pedido explícito: en la web ya
  // están las flechas subir/bajar, que ahí funcionan bien con mouse; en la
  // App no había NINGUNA forma de reordenar, las flechas quedaban ocultas).
  // Reusa el mismo commit por lotes que moveSubject, solo cambia cómo se
  // arma la lista nueva (mover un elemento a cualquier posición, no solo
  // intercambiar con el vecino).
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragCardRefs = useRef([])
  const dragStateRef = useRef({ dragIndex: null, overIndex: null })

  // Esta lista es SIEMPRE de asignaturas vivas, en web y en app. En la web las
  // archivadas ya tienen su propia sección en el panel lateral; mezclarlas aquí
  // con una etiqueta era tenerlas en dos lugares y alargaba la lista con cosas
  // que ya terminaron. El conteo de arriba cuenta lo mismo que se ve.
  const mainList = subjects.filter((s) => !s.archived)
  // Solo la App las agrupa aquí abajo — la web las tiene en el panel lateral.
  const archivedList = IS_NATIVE_APP ? subjects.filter((s) => s.archived) : []

  // Lista mostrada mientras se arrastra: el elemento arrastrado ya aparece
  // en su posición "de prueba" (overIndex), aunque todavía no se guardó
  // nada — el commit real solo pasa al soltar.
  const displaySubjects = dragIndex == null ? mainList : (() => {
    const arr = [...mainList]
    const [item] = arr.splice(dragIndex, 1)
    arr.splice(overIndex ?? dragIndex, 0, item)
    return arr
  })()

  function dragPointerDown(e, index) {
    e.preventDefault()
    setDragIndex(index)
    setOverIndex(index)
    dragStateRef.current = { dragIndex: index, overIndex: index }
    window.addEventListener('pointermove', dragPointerMove)
    window.addEventListener('pointerup', dragPointerUp)
    window.addEventListener('pointercancel', dragPointerUp)
  }
  function dragPointerMove(e) {
    const y = e.clientY
    let newOver = dragStateRef.current.overIndex
    dragCardRefs.current.forEach((el, i) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) newOver = i
    })
    if (newOver !== dragStateRef.current.overIndex) {
      dragStateRef.current.overIndex = newOver
      setOverIndex(newOver)
    }
  }
  async function dragPointerUp() {
    window.removeEventListener('pointermove', dragPointerMove)
    window.removeEventListener('pointerup', dragPointerUp)
    window.removeEventListener('pointercancel', dragPointerUp)
    const { dragIndex: from, overIndex: to } = dragStateRef.current
    setDragIndex(null)
    setOverIndex(null)
    if (from == null || to == null || from === to) return
    const newList = [...mainList]
    const [item] = newList.splice(from, 1)
    newList.splice(to, 0, item)
    // Reordena solo las activas — las archivadas conservan su orden previo,
    // ya no compiten por posición en la lista visible.
    const newOrden = new Map(newList.map((s, i) => [s.id, i + 1]))
    setSubjects((prev) => prev.map((s) => (newOrden.has(s.id) ? { ...s, orden: newOrden.get(s.id) } : s)))
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'subjects', s.id), { orden: i + 1 }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault()
    if (faltan.length) return
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCreatingSubject(true)
    try {
      const subData = {
        nombre: newSubjectName.trim(),
        grupo: newSubjectGrupo.trim(),
        docenteId: currentUser.uid,
        // Sin `|| 'sin-escuela'`: la escuela es obligatoria y el guard de
        // rutas no deja llegar hasta aquí sin una real (ver utils/escuela.js).
        escuelaId: userProfile.escuelaId,
        parciales: numParciales,
        // Al crearla ningún parcial tiene contenido todavía — el primero
        // queda visible para el estudiante desde el inicio, los demás
        // ocultos por defecto (pedido explícito) hasta que el docente
        // decida mostrarlos con el ojo del encabezado del parcial.
        parcialesOcultos: Array.from({ length: Math.max(0, numParciales - 1) }, (_, i) => i + 2),
        fechaInicio,
        fechaFin,
        parcialesFechas: normalizeParcialesFechas(fechaInicio, fechaFin, numParciales, parcialesFechas),
        colorPalette: palette,
        icon: newSubjectIcon,
        accessCode: generateAccessCode(),
        archived: false,
        // La pestaña Asistencias del estudiante nace visible; el docente la
        // apaga por asignatura desde Asistencias. Ausente también = visible.
        mostrarAsistenciasEstudiantes: true,
        orden: subjects.length + 1,
        createdAt: serverTimestamp(),
      }
      // Sin append optimista aquí: el onSnapshot de arriba (única fuente de
      // verdad, mismo criterio que moveSubject/dragPointerUp) ya recibe esta
      // asignatura nueva por su cuenta — casi siempre ANTES de que este
      // await se resuelva, porque Firestore refleja la escritura local de
      // inmediato. Un append manual sobre `prev` corría el riesgo real de
      // sumarla otra vez sobre un estado que el snapshot ya había
      // actualizado, duplicando la key en el sidebar (bug real observado:
      // "Encountered two children with the same key").
      const ref = await addDoc(collection(db, 'subjects'), subData)
      setShowSubjectModal(false)
      setNewSubjectName('')
      setNewSubjectGrupo('')
      setNewSubjectParciales(null)
      setNewSubjectPalette(null)
      setNewSubjectIcon('book')
      setNewSubjectFechaInicio(null)
      setNewSubjectFechaFin(null)
      setNewSubjectParcialesFechas(null)
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCreatingSubject(false)
    }
  }

  const teacherGreetingName = teacherDisplayName(userProfile) || 'Docente'

  return (
    <>
      <div data-esq="dash-doc-contenedor" className={`px-4 py-4 ${TEACHER_CONTAINER}`}>

        {/* Saludo — "Hola {nombre}". La foto de perfil ya no vive aquí: es el
            primer botón de la barra inferior (a la izquierda) y se cambia en
            Perfil. "{prefijo} {nombre visible}" es el mismo que ven los
            alumnos (teacherDisplayName). El nombre va en un inline-block y
            SIN truncate: si no cabe junto a "Hola", baja entero al siguiente
            renglón en vez de cortarse a media palabra. */}
        <div data-esq="dash-doc-saludo" className="mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <h1 data-esq="dash-doc-saludo-nombre" className="text-lg font-bold text-on-surface min-w-0">
              Hola <span className="inline-block">{teacherGreetingName}</span>
            </h1>
          </div>
          {userProfile?.schoolName && (
            <p data-esq="dash-doc-saludo-escuela" className="text-hint text-xs mt-0.5 truncate">{userProfile.schoolName}</p>
          )}
        </div>
        {loading ? (
          <EsqueletoTableroDocente />
        ) : (
          <>
            {/* ── Mis asignaturas ── */}
            {/* El conteo va entre paréntesis pegado al título, no como texto
                aparte a la derecha: decir "Mis asignaturas … 4 asignaturas" en
                el mismo renglón repetía la palabra dos veces para dar un solo
                dato. Es la misma forma que ya usa "Archivadas (1)" más abajo.
                Con cero no se pone "(0)": la tarjeta de abajo ya dice que
                todavía no hay asignaturas. */}
            <h2 data-esq="dash-doc-titulo" className="text-lg font-semibold text-on-surface mb-2">
              Mis asignaturas{mainList.length > 0 ? ` (${mainList.length})` : ''}
            </h2>

            {mainList.length === 0 ? (
              <div className="bg-surface-card rounded-card border border-outline-variant p-8 text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
                  <BookOpen size={ICONO.lg} className="text-accent" />
                </div>
                <p className="text-muted font-medium mb-2">Aún no tienes asignaturas</p>
                <Button icon={Plus} iconEffect="gira90"
                  onClick={openSubjectModal}>
                  
                  Crear mi primera asignatura
                </Button>
              </div>
            ) : (
              <div data-esq="dash-doc-lista" className="space-y-2 mb-4 cascada">
                {/* Fila en píldora, como «Nueva asignatura» de abajo. pl-6 pone
                    las flechas en el centro de la curva: así quedan a la misma
                    distancia del borde redondo que de arriba y abajo (py-1.5). */}
                {displaySubjects.map((s, i) => (
                  <div data-esq="dash-doc-fila"
                    key={s.id}
                    ref={(el) => { dragCardRefs.current[i] = el }}
                    {...subjectPaletteProps(s.colorPalette)}
                    className={`w-full bg-surface-card rounded-full py-1.5 pl-6 pr-4 shadow-card hover:shadow-card-hover hover:bg-[var(--accent-tint)] transition flex items-center gap-1 ${dragIndex === i ? 'opacity-60 shadow-lg' : ''}`}
                  >
                    {/* Reordenar: flechas en la web, arrastrar en la App
                        (pedido explícito — antes no había forma de
                        reordenar desde el celular). */}
                    {IS_NATIVE_APP ? (
                      <button
                        type="button"
                        onPointerDown={(e) => dragPointerDown(e, i)}
                        aria-label="Arrastrar para reordenar"
                        data-tooltip="Mantén y arrastra para reordenar"
                        className="size-control inline-flex items-center justify-center -m-1 text-hint hover:text-accent flex-shrink-0 cursor-grab active:cursor-grabbing touch-none rounded-full"
                      >
                        <GripVertical size={ICONO.md} />
                      </button>
                    ) : (
                      <div className="flex flex-col flex-shrink-0">
                        <IconButton icon={ArrowUp} label="Subir" tooltip={false} onClick={() => moveSubject(i, -1)}
                          disabled={i === 0}
                          data-tooltip="Subir" />
                        <IconButton icon={ArrowDown} label="Bajar" tooltip={false} onClick={() => moveSubject(i, 1)}
                          disabled={i === subjects.length - 1}
                          data-tooltip="Bajar" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/subject/${s.id}`)}
                      className="group flex-1 min-w-0 text-left flex items-center gap-2 pr-3 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div data-esq="dash-doc-icono" className="w-11 h-11 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
                        <SubjectIcon iconKey={s.icon} size={ICONO.md} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Sin etiqueta "archivada": a esta lista ya solo
                            llegan asignaturas vivas, así que nunca se
                            mostraría. */}
                        <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
                        {/* Solo en la web de ESCRITORIO — pedido explícito: en
                            la App y en el teléfono (web) no deben verse las
                            fechas de inicio y fin junto a las asignaturas. */}
                        {!IS_NATIVE_APP && !telefonoWeb.telefono && subjectPeriodLabel(s) && (
                          <p className="text-sm text-muted mt-0.5">{subjectPeriodLabel(s)}</p>
                        )}
                      </div>
                      <FlechaFila />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Nueva asignatura al pie de la lista — pedido explícito. Solo en
                la WEB: en la App ese lugar ya lo ocupa el botón flotante.
                Borde punteado (mismo lenguaje que "Unirme a otra asignatura"
                del estudiante) para leerse como "agregar aquí" sin competir
                con las tarjetas de asignatura, que son las que mandan.
                Solo aparece si ya hay asignaturas: cuando la lista está vacía,
                la tarjeta de "Crear mi primera asignatura" ya cumple ese rol. */}
            {!IS_NATIVE_APP && mainList.length > 0 && (
              <Button variant="cta-dashed" icon={Plus} iconEffect="gira90" className="mb-4" onClick={openSubjectModal}>
                Nueva asignatura
              </Button>
            )}

            {/* Perfil para IA del docente — arriba del QR, solo en la App
                (en la web vive en el menú lateral, arriba del QR también).
                Ver FASE 2-BIS del Plan Maestro de IA. */}
            {IS_NATIVE_APP && (
              <button type="button" onClick={() => navigate('/perfil-ia')} className={`${TARJETA_FILA} mb-3`}>
                <IconTile><Animado efecto="destello"><Sparkles size={ICONO.md} /></Animado></IconTile>
                <span className="flex-1 min-w-0 font-semibold text-on-surface">Perfil para IA del docente</span>
                <FlechaFila />
              </button>
            )}

            {/* QR general de Evalúa Fácil — solo en la App, arriba de
                "Archivadas". En la web el mismo botón vive en el menú lateral. */}
            {IS_NATIVE_APP && (
              <AppQRButton iconSize={ICONO.md} className={`${TARJETA_FILA} mb-3 [&>svg:first-child]:text-accent [&>svg:first-child]:mx-3`}>
                <span className="flex-1 min-w-0 font-semibold text-on-surface">QR de Evalúa Fácil</span>
                <FlechaFila />
              </AppQRButton>
            )}

            {/* Archivadas — solo en la App (en la web ya viven en el sidebar,
                colapsadas igual que aquí). Mismo lenguaje: ícono Archive,
                contador, flecha que gira, e items con sangrado (pl-9, tras
                el ícono) para leerse "dentro" del grupo. */}
            {IS_NATIVE_APP && archivedList.length > 0 && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setShowArchived((a) => !a)}
                  aria-expanded={showArchived}
                  className="flex items-center gap-2 w-full h-control px-3 rounded-full text-muted hover:bg-surface-container transition-colors"
                >
                  <Archive size={ICONO.sm} className="flex-shrink-0" />
                  <span className="flex-1 text-left text-sm font-semibold">Archivadas ({archivedList.length})</span>
                  <ChevronRight size={ICONO.sm} className={`flex-shrink-0 transition-transform duration-estandar ${showArchived ? 'rotate-90' : ''}`} />
                </button>
                {showArchived && (
                  <div className="space-y-1 mt-1 animate-aparece motion-reduce:animate-none">
                    {archivedList.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/subject/${s.id}`)}
                        className="w-full flex items-center gap-2 pl-9 pr-3 h-control rounded-full text-left text-muted hover:bg-surface-container transition-colors"
                      >
                        <SubjectIcon iconKey={s.icon} size={ICONO.sm} className="flex-shrink-0" />
                        <span className="truncate text-sm">{subjectDisplayName(s)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recordatorio de la versión web — solo en la App. Se ve solo el
                título; el detalle y la dirección se despliegan al tocarlo.
                A propósito NO navega: tocarlo abre y cierra, nada más. Por eso
                el chevron GIRA (mismo lenguaje que "Archivadas" arriba) en vez
                de apuntar siempre a la derecha, que prometería un destino. */}
            {IS_NATIVE_APP && (
              <DisclosureCard icon={Globe} title="🚀 Lleva tu productividad al siguiente nivel" className="mt-3">
                <p>Organiza tus asignaturas, configura actividades, consulta reportes y utiliza todas las herramientas de Evalúa Fácil desde la versión web, diseñada para ofrecerte la mejor experiencia de trabajo en computadora.</p>
                    <p>Es tu misma cuenta: inicia sesión con el mismo correo y contraseña. Todo lo que hagas en la app se refleja en la versión web, y viceversa.</p>
                    <p className="font-semibold text-accent">www.evaluafacil.mx</p>
              </DisclosureCard>
            )}

            {/* En la WEB se informa que Evalúa Fácil también funciona en el
                celular mediante el navegador. Colapsado e informativo, sin
                invitar a descargar una app que todavía no existe en tiendas. */}
            {!IS_NATIVE_APP && (
              <DisclosureCard icon={Smartphone} title="Evalúa Fácil en tu celular" className="mt-3">
                <p>Evalúa Fácil solo funciona en la web por ahora. Puedes abrirla desde el navegador de tu celular igual que en la computadora — es la misma cuenta, todo sincronizado.</p>
              </DisclosureCard>
            )}

            {/* Canal oficial de YouTube — solo en la web (el componente no se
                pinta en la app). Misma tarjeta que la de arriba, pero esta SÍ
                navega: por eso la flecha queda fija a la derecha, sin girar. */}
            <CanalYouTubeLink className={`${TARJETA_FILA} mt-3`}>
              <IconTile><YouTubeIcon className="w-6 h-auto" /></IconTile>
              <span className="flex-1 min-w-0 font-semibold text-on-surface">Evalúa Fácil en YouTube</span>
              <FlechaFila external />
            </CanalYouTubeLink>

          </>
        )}
      </div>

      {/* FAB — create subject, solo en la App. En la web (móvil y escritorio)
          ya están "Nueva asignatura" al pie de la lista y "Crear mi primera
          asignatura" en la tarjeta vacía; el FAB los duplicaba. */}
      {IS_NATIVE_APP && (
        <Button
          variant="fab"
          icon={Plus}
          iconEffect="gira90"
          onClick={openSubjectModal}
          aria-label="Nueva asignatura"
          className="md:hidden fixed bottom-[calc(var(--barra-alto)+1.5rem+env(safe-area-inset-bottom))] right-4 z-20"
        />
      )}

      {/* ── Nueva asignatura modal ── */}
      {showSubjectModal && (
        <Modal open onClose={() => setShowSubjectModal(false)} variant="sheet" size="md" z={40} padding="p-4" className="overflow-x-hidden" ariaLabel="Nueva asignatura">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-on-surface">Nueva asignatura</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowSubjectModal(false)} />
            </div>
            <form onSubmit={handleCreateSubject} className="space-y-2">
              {/* Nombre de la asignatura */}
              <Input
                label="Asignatura"
                id="dash-asignatura"
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                required
                // Se abre para escribir el nombre: el foco va directo al
                // primer campo (solo con mouse; en táctil abriría el teclado
                // de golpe — ver PUEDE_AUTOFOCUS).
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={PUEDE_AUTOFOCUS}
              />
              {/* Grupo */}
              <Input
                label="Grupo"
                id="dash-grupo"
                type="text"
                value={newSubjectGrupo}
                onChange={(e) => setNewSubjectGrupo(e.target.value)}
                required
              />

              {/* Fechas (obligatorias — pedido explícito de Kike, 17-ago-2026:
                  sin ellas no funcionan bien los bloques de horario, el
                  horario y agenda, las asistencias ni la Planeación Inicial). */}
              <div>
                <p className="block text-sm font-medium text-muted mb-1">Fechas del curso</p>
                <p className="text-sm text-muted mb-1.5">Son obligatorias: con ellas se generan los días para marcar asistencia, se organiza cada parcial por periodo, y se arma tu horario y tu Planeación Inicial.</p>
                <div className="space-y-2">
                  <div>
                    <span className="block text-sm text-muted mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" etiqueta="Inicio del curso" value={fechaInicio} onChange={setNewSubjectFechaInicio} />
                  </div>
                  <div>
                    <span className="block text-sm text-muted mb-1">Fin</span>
                    <EFDateTimePicker mode="date" etiqueta="Fin del curso" value={fechaFin} onChange={setNewSubjectFechaFin}
                      minDateTime={fechaInicio ? addOneDay(fechaInicio) : undefined}
                      disabled={!fechaInicio} />
                  </div>
                </div>
                {fechasDelCiclo && (
                  <p className="text-xs text-hint mt-1">
                    Tomadas de «{subjectDisplayName(ciclo)}», tu asignatura de este ciclo. Cámbialas si esta lleva otras.
                  </p>
                )}
              </div>

              {/* Parciales — mismo control que "Editar asignatura", para que
                  crear y editar se vean y se usen igual. */}
              <div>
                <Select
                  id="dash-parciales"
                  label="Número de parciales"
                  value={numParciales}
                  onChange={setNewSubjectParciales}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} ${n === 1 ? 'parcial' : 'parciales'}` }))}
                />
              </div>

              {/* Fechas por parcial (solo si ya hay fechas del curso) */}
              {fechaInicio && fechaFin && (
                <ParcialesFechas
                  fechaInicio={fechaInicio}
                  fechaFin={fechaFin}
                  numParciales={numParciales}
                  value={parcialesFechas}
                  onChange={setNewSubjectParcialesFechas}
                />
              )}

              {/* Paleta de color */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">
                  Color de la asignatura <span className="text-hint font-normal text-xs">(elige el color base que identificará a la asignatura)</span>
                </p>
                <PaletteSelect value={palette} onChange={setNewSubjectPalette} />
              </div>

              {/* Icono */}
              <div {...subjectPaletteProps(palette)}>
                <p className="block text-sm font-medium text-muted mb-2">
                  Icono de la asignatura
                </p>
                <IconSelect value={newSubjectIcon} onChange={setNewSubjectIcon} />
              </div>

              {/* pie-hoja: el botón se queda fijo abajo mientras se llena el formulario. */}
              <div className="pie-hoja">
                <Button
                  type="submit"
                  size="lg"
                  fullWidth
                  icon={Plus}
                  iconEffect="gira90"
                  busy={creatingSubject}
                  disabled={faltan.length > 0}
                >
                  {creatingSubject ? 'Creando…' : 'Crear asignatura'}
                </Button>
                <MotivoApagado faltan={faltan} />
              </div>
            </form>
          </Modal>
      )}
    </>
  )
}
