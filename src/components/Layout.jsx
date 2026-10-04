import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  LogOut,
  Plus,
  Archive,
  ChevronRight,
  CalendarDays,
  Bell,
  BookOpen,
  Sparkles,
  Settings,
  CirclePlay,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { configurarBloqueoExportacion } from '../utils/exportGuard'
import { subjectDisplayName } from '../utils/subjectName'
import { IS_NATIVE_APP } from '../utils/platform'
import SubjectIcon from './SubjectIcon'
import PortalBadge from './PortalBadge'
import EFLogo from './EFLogo'
import AppQRButton from './AppQRButton'
import ConfirmModal from './ConfirmModal'
import SkipLink from './SkipLink'
import CreditosBar from './CreditosBar'
import { teacherDisplayName } from '../utils/studentSearch'
import { SB_FILA, SB_INACTIVA, SB_ACTIVA, SB_ACTIVA_SUAVE, SB_GRUPO, SB_ICONO, NAV_ITEM } from '../config/sidebar'
import AvatarNav from './AvatarNav'
import CanalYouTubeLink from './CanalYouTubeLink'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { EsqueletoFilasLateral } from './esqueletos'

// Indicador de pestaña activa en la barra inferior — un rectángulo de
// esquinas ovaladas relleno de color detrás del ícono (pedido explícito,
// solo en la App; en la web móvil solo cambia de color como antes).
// Menú secundario del sidebar (perfil IA, QR, notificaciones, ayuda,
// archivadas, salir). Una sola clase para todos: antes cada bloque repetía la
// suya y habían divergido —py-1.5 en unos, py-2 en otros—, así que los
// renglones no medían igual. gap-2 y px-3 son los mismos del menú
// principal, para que TODO el sidebar alinee su texto en una vertical.
const ITEM_SECUNDARIO = SB_FILA
// Pantallas que viven dentro del submenú «Ajustes y ayuda» de la barra lateral.
const RUTAS_AJUSTES = ['/perfil-ia', '/notificaciones', '/ayuda']
const ITEM_SEC_INACTIVO = SB_INACTIVA
const ITEM_SEC_ACTIVO = SB_ACTIVA_SUAVE

function navIconPillCls(isActive) {
  if (!IS_NATIVE_APP) return ''
  return `px-5 py-1 rounded-full transition-colors ${isActive ? 'bg-[var(--accent-light)]' : ''}`
}

export default function TeacherLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Submenú «Ajustes y ayuda»: null = automático (abierto solo si estás en una de
  // sus pantallas); true/false = lo decidió el usuario con el botón.
  const [ajustesManual, setAjustesManual] = useState(null)
  const enAjustes = RUTAS_AJUSTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  const ajustesAbierto = ajustesManual ?? enAjustes

  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  useBackHandler(() => setConfirmLogout(false), confirmLogout)
  useScrollLock(confirmLogout)

  // Real-time subjects: any create/edit/archive/duplicate/delete reflects instantly
  // in the sidebar (no manual refresh).
  useEffect(() => {
    if (!currentUser) return
    const q = query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setSubjects(list)
        setLoadingSidebar(false)
      },
      () => setLoadingSidebar(false)
    )
    return () => unsub()
  }, [currentUser])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }
  // En la app nativa se pide confirmación antes de salir (es fácil tocar el
  // botón sin querer en el celular); en la web se sale directo, como siempre.
  const requestLogout = () => (IS_NATIVE_APP ? setConfirmLogout(true) : handleLogout())

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  // Modelo de créditos puros: ya no hay candado de suscripción, de plan ni de
  // saldo — toda la plataforma que no es IA (asignaturas, estudiantes,
  // actividades, asistencia, descargas) es gratis para cualquier docente
  // autenticado. Los créditos cubren ÚNICAMENTE operaciones de IA.

  // Descargas: GRATUITAS (26-ago-2026). Hasta hoy exportGuard.js las
  // bloqueaba con saldo 0 — eran un "bonus asociado a tener créditos IA
  // activos" (21-ago-2026). Ese modelo se descartó: la plataforma es gratuita
  // y los créditos cubren ÚNICAMENTE operaciones de IA, no descargas,
  // asistencias ni actividades interactivas.
  //
  // Se pasa `bloqueado: () => false` en vez de borrar exportGuard.js porque
  // decenas de pantallas importan saveWorkbook/savePdfDoc/saveBlob desde ahí:
  // el módulo queda como punto único de paso, inerte, exactamente igual que
  // firestoreGuard.js cuando se retiró el candado de suscripción. Si algún día
  // hace falta un candado de descargas, el cable ya está puesto.
  useEffect(() => {
    configurarBloqueoExportacion({ bloqueado: () => false })
    return () => configurarBloqueoExportacion({ bloqueado: () => false })
  }, [])

  // Mismo nombre que ven sus estudiantes — prefijo (Mtro./Profe/…) + el
  // nombre público que eligió, no su nombre real. teacherDisplayName es la
  // única fuente de esto en el proyecto (ver utils/studentSearch.js), así que
  // se reutiliza en vez de rearmar la combinación aquí.
  const displayName = teacherDisplayName(userProfile) || 'Docente'
  // El avatar toma la inicial del nombre SIN el prefijo — con prefijo, "Mtro.
  // Juan" mostraría "M" en el círculo, que no identifica a nadie.
  const initials = (userProfile?.nombreMostrar || userProfile?.nombre || displayName).charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-surface">
      <SkipLink />
      {/* Mobile top bar — en la app nativa siempre visible; en la web se oculta
          en escritorio (md:hidden). El WebView de Android a veces reporta un
          viewport ≥768px activando el breakpoint md: de Tailwind, lo que
          mostraría el sidebar en lugar de la navegación móvil. */}
      <header data-esq="sesion-encabezado-movil" className={`${IS_NATIVE_APP ? '' : 'md:hidden'} sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 h-[var(--barra-alto)] flex items-center justify-between shadow-card safe-top`}>
        <div className="flex items-center gap-2 min-w-0">
          <EFLogo subtitle={false} className="h-8 w-auto flex-shrink-0" />
          {/* eslint-disable-next-line jsx-a11y/aria-role -- `role` aquí es la prop propia de PortalBadge, no un atributo ARIA */}
          <PortalBadge role="docente" />
        </div>
        <div className="flex items-center gap-1">
          {/* Créditos IA — visibles sin entrar a ninguna sección (chip compacto) */}
          <CreditosBar variant="movil" />
          <NavLink
            to="/ayuda"
            aria-label="Ayuda para comenzar"
            className="p-2 text-muted hover:text-accent rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <BookOpen size={20} />
          </NavLink>
          <button
            type="button"
            onClick={requestLogout}
            aria-label="Cerrar sesión"
            className="p-2 text-muted hover:text-error rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Desktop: sidebar + content.
          En App nativa NO usamos flex row: el sidebar no existe y el flex
          container puede reportar un ancho menor que el visual viewport del
          S23, dejando la franja azul a la derecha. Con un div block normal
          <main> ocupa el 100% real de la pantalla. */}
      <div className={IS_NATIVE_APP ? '' : 'flex'}>
        {/* Sidebar — en la app nativa siempre oculto (el WebView puede reportar
            viewport ≥768px activando md:flex); en la web solo en escritorio. */}
        <aside data-esq="sesion-lateral" className={`${IS_NATIVE_APP ? 'hidden' : 'hidden md:flex'} flex-col w-[300px] h-screen overflow-y-auto sticky top-0 bg-accent text-white flex-shrink-0 z-20`}>
          {/* Logo — siempre sobre blanco: recuadro blanco sobre el azul del sidebar. */}
          {/* px-2 (no px-3): el recuadro blanco tiene que arrancar en la misma
              vertical que las píldoras de abajo, que van con mx-2. */}
          <div className="px-2 pt-2 pb-1">
            <div className="bg-white rounded-card px-3 py-2.5 shadow-card">
              <EFLogo className="w-full h-auto" />
            </div>
            {/* Versión y etiqueta de rol comparten renglón: versión a la izquierda,
                rol a la derecha. La versión es solo de la web — en la app vive en
                Perfil, y la etiqueta se queda sola. */}
            <div className="flex items-center gap-2 pt-1">
              {!IS_NATIVE_APP && (
                <p className="text-metadata text-white/50 pl-3">
                  {new Date(__BUILD_TIMESTAMP__).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              )}
              {/* eslint-disable-next-line jsx-a11y/aria-role -- `role` aquí es la prop propia de PortalBadge, no un atributo ARIA */}
              <PortalBadge role="docente" className="ml-auto" />
            </div>
          </div>

          {/* Profile button — pegado al logo (sin mt-1) para que el nombre y
              la foto suban y no dejen un hueco vacío arriba, pedido explícito
              para aprovechar mejor el espacio del panel. */}
          <NavLink
            to="/profile"
            className="flex items-center gap-3 px-4 py-2 mx-2 rounded-card hover:bg-white/10 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {/* 65px pedido explícito. */}
            <div className="w-[65px] h-[65px] rounded-full bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-accent">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* 18 / 16 px pedidos explícito. */}
              <p className="text-[18px] font-semibold text-white truncate">{displayName}</p>
              <p className="text-[16px] text-white/70 truncate">
                {userProfile?.schoolName || 'Mi perfil'}
              </p>
            </div>
            <ChevronRight size={16} className="text-white/50 group-hover:text-white/80 flex-shrink-0" />
          </NavLink>

          {/* Horario y Agenda — misma fila estándar; se distingue por su fondo */}
          <div className="px-2">
            <NavLink
              to="/calendario"
              className={({ isActive }) =>
                `${SB_FILA} font-semibold ${
                  isActive ? SB_ACTIVA : 'bg-white/15 text-white hover:bg-white/25 ring-1 ring-white/30'
                }`
              }
            >
              <CalendarDays size={SB_ICONO} className="flex-shrink-0" />
              Horario y Agenda
            </NavLink>
          </div>

          {/* Subjects header → goes to the full subjects list */}
          <NavLink to="/dashboard" className="mx-2 mt-2 pl-4 pr-2 py-2 flex items-center justify-between rounded-full hover:bg-white/10 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {/* De ~14 a 22 px (pedido explícito): pasaba desapercibida pese a
                ser un link a la lista completa. Se quita `uppercase` — en
                mayúsculas a este tamaño se lee como un GRITO, no como
                énfasis; el peso ya viene de font-bold heredado de
                text-label-caps. */}
            <span className="text-[22px] font-bold text-white/70 group-hover:text-white transition-colors">
              Asignaturas
            </span>
            <ChevronRight size={18} className="text-white/50 group-hover:text-white transition-colors flex-shrink-0" />
          </NavLink>

          {/* Subject list */}
          <div className="flex-1 min-h-32 overflow-y-auto px-2 pb-2 space-y-1">
            {loadingSidebar ? (
              <EsqueletoFilasLateral />
            ) : activeSubjects.length === 0 ? (
              <p className="text-body-sm text-white/70 px-4 py-2.5">Sin asignaturas aún</p>
            ) : (
              activeSubjects.map((s) => (
                <NavLink data-esq="sb-fila"
                  key={s.id}
                  to={`/subject/${s.id}`}
                  className={({ isActive }) =>
                    `${SB_FILA} ${isActive ? SB_ACTIVA : SB_INACTIVA}`
                  }
                >
                  <SubjectIcon iconKey={s.icon} size={SB_ICONO} className="flex-shrink-0" />
                  {/* 14 px pedido explícito — antes text-body-sm (13.5 px, por
                      la raíz de 14.4 del proyecto). Solo el nombre de la
                      asignatura, no el resto del panel. */}
                  <span className="truncate">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}

            {/* Nueva asignatura */}
            <button
              type="button"
              onClick={() => navigate('/dashboard', { state: { openCreate: true } })}
              className={`${SB_FILA} text-white hover:bg-white/10`}
            >
              <Plus size={20} className="flex-shrink-0" />
              Nueva asignatura…
            </button>
          </div>

          {/* Notificaciones — reubicada aquí a propósito, deliberadamente menos
              prominente que "Horario y Agenda" (pedido explícito: no darle
              tanto énfasis en la web). Fija justo arriba de "Archivadas",
              exista o no todavía alguna asignatura archivada. Mismos ajustes
              que en la app móvil (activar/desactivar avisos, el registro de lo
              enviado); casi todo lo que controla solo aplica en el celular
              donde esté instalada la app, pero se puede gestionar desde aquí. */}
          {/* QR general de Evalúa Fácil — arriba de Notificaciones. Va aquí y no
              dentro de una asignatura porque es el MISMO para todas. */}
          {/* Un solo grupo con UNA divisoria arriba. Antes cada enlace vivía
              en su propio <div> con su propio `border-t`, así que salía una
              línea entre cada renglón y el menú se leía como cinco cajas
              apiladas en vez de una lista. */}
          {/* Área compartida: enlaces secundarios + Archivadas en UN solo
              bloque con UN solo scroll. Cuando la ventana es baja, la lista de
              asignaturas conserva su mínimo (min-h-32) y lo que cede es esta
              área, que se desplaza por dentro; Créditos y Cerrar sesión quedan
              fuera y nunca ceden. Mientras todo cabe, no hay scroll y el menú
              se ve igual que antes. min-h-12: nunca menos que el botón de
              Archivadas. */}
          <div className="mt-2 min-h-12 overflow-y-auto border-t border-white/15">
            <div className={SB_GRUPO}>
              {/* Un solo botón abre el submenú: las cinco herramientas de apoyo
                  (perfil de IA, QR, avisos, ayuda y tutoriales) viven dentro en
                  lugar de ocupar cinco filas fijas. Disclosure accesible:
                  aria-expanded + aria-controls, el teclado lo opera con
                  Enter/Espacio y el foco queda en el botón. */}
              <button
                type="button"
                id="boton-ajustes"
                aria-expanded={ajustesAbierto}
                aria-controls="submenu-ajustes"
                onClick={() => setAjustesManual(!ajustesAbierto)}
                className={`${ITEM_SECUNDARIO} ${ajustesAbierto || enAjustes ? ITEM_SEC_ACTIVO : ITEM_SEC_INACTIVO}`}
              >
                <Settings size={SB_ICONO} className="flex-shrink-0" />
                <span className="flex-1 text-left">Ajustes y ayuda</span>
                <ChevronRight size={16} className={`flex-shrink-0 transition-transform ${ajustesAbierto ? 'rotate-90' : ''}`} />
              </button>
              {ajustesAbierto && (
                <div id="submenu-ajustes" className="space-y-1">
                {/* Perfil para IA del docente — arriba del QR, pedido explícito
                    (FASE 2-BIS del Plan Maestro de IA). Contexto general del
                    docente, se captura una sola vez y se reutiliza en todas las
                    funciones de IA de sus asignaturas. */}
                <NavLink
                  to="/perfil-ia"
                  title="Necesario para generar planeación y diagnósticos con IA"
                  className={({ isActive }) =>
                    `${ITEM_SECUNDARIO} pl-8 ${isActive ? ITEM_SEC_ACTIVO : ITEM_SEC_INACTIVO}`
                  }
                >
                  <Sparkles size={SB_ICONO} className="flex-shrink-0" />
                  Perfil para IA del docente
                </NavLink>

                <AppQRButton className={`${ITEM_SECUNDARIO} pl-8 ${ITEM_SEC_INACTIVO}`}>
                  QR de Evalúa Fácil
                </AppQRButton>

                <NavLink
                  to="/notificaciones"
                  className={({ isActive }) =>
                    `${ITEM_SECUNDARIO} pl-8 ${isActive ? ITEM_SEC_ACTIVO : ITEM_SEC_INACTIVO}`
                  }
                >
                  <Bell size={SB_ICONO} className="flex-shrink-0" />
                  Notificaciones
                </NavLink>

                <NavLink
                  to="/ayuda"
                  className={({ isActive }) =>
                    `${ITEM_SECUNDARIO} pl-8 ${isActive ? ITEM_SEC_ACTIVO : ITEM_SEC_INACTIVO}`
                  }
                >
                  <BookOpen size={SB_ICONO} className="flex-shrink-0" />
                  Ayuda para comenzar
                </NavLink>

                {/* Canal oficial de YouTube — enlace externo, por eso no es un
                    NavLink ni tiene estado activo. Solo vive en el sidebar: la
                    barra superior del móvil no lleva un ícono más. */}
                <CanalYouTubeLink className={`${ITEM_SECUNDARIO} pl-8 ${ITEM_SEC_INACTIVO}`}>
                  <CirclePlay size={SB_ICONO} className="flex-shrink-0" />
                  Canal de YouTube
                </CanalYouTubeLink>
                </div>
              )}
            </div>

            {/* Archivadas — al final del área compartida. El botón va `sticky`
                arriba y abajo: se queda a la vista aunque el área se desplace,
                y por eso lleva el mismo fondo del menú (lo que pasa por detrás
                no debe transparentarse). Sus asignaturas ya no tienen scroll
                propio: usan el del área compartida. */}
            {archivedSubjects.length > 0 && (
              <>
                <div className={`sticky top-0 bottom-0 z-10 bg-accent px-2 ${showArchived ? '' : 'pb-2'}`}>
                  <button
                    type="button"
                    onClick={() => setShowArchived((a) => !a)}
                    aria-expanded={showArchived}
                    className={`${ITEM_SECUNDARIO} text-white/60 hover:bg-white/10 hover:text-white`}
                  >
                    <Archive size={SB_ICONO} className="flex-shrink-0" />
                    <span className="flex-1 text-left">Archivadas ({archivedSubjects.length})</span>
                    {/* La flecha va a la DERECHA de la palabra (pedido explícito)
                        y gira al desplegar — mismo lenguaje que un <details>, sin
                        serlo, para no perder el estilo propio del botón. */}
                    <ChevronRight size={16} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-90' : ''}`} />
                  </button>
                </div>
                {showArchived && (
                  <div className="px-2 pt-1 pb-2 space-y-1">
                    {archivedSubjects.map((s) => (
                      // pl-10: el nombre (tras el ícono) debe empezar más a la
                      // derecha de donde arranca la palabra "Archivadas" en el
                      // botón de arriba — pl-6 ya no alcanzaba una vez que la
                      // flecha se movió al final; el texto del botón quedó más a
                      // la izquierda (justo después del ícono Archive) y el
                      // sangrado tuvo que crecer para seguir leyéndose "dentro".
                      <NavLink
                        key={s.id}
                        to={`/subject/${s.id}`}
                        className={({ isActive }) =>
                          `${SB_FILA} pl-12 ${isActive ? SB_ACTIVA : SB_INACTIVA}`
                        }
                      >
                        <SubjectIcon iconKey={s.icon} size={SB_ICONO} className="flex-shrink-0" />
                        <span className="truncate">{subjectDisplayName(s)}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Créditos IA — barra permanente del docente (clic → panel) */}
          <div className="flex-shrink-0">
            <CreditosBar variant="sidebar" />
          </div>


          {/* Logout */}
          <div className="flex-shrink-0 px-2 py-2 border-t border-white/15">
            <button
              type="button"
              onClick={requestLogout}
              className={`${ITEM_SECUNDARIO} ${ITEM_SEC_INACTIVO}`}
            >
              <LogOut size={SB_ICONO} className="flex-shrink-0" />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main content — pb reserva el alto de la barra inferior (5rem) MÁS el
            inset de seguridad de Android que ya se le suma a esa barra
            (.safe-bottom en <nav> abajo); si no, el último contenido de cada
            página queda tapado detrás de la barra, que ahora es más alta.
            En la app nativa siempre se reserva ese padding (el sidebar nunca
            aparece), en la web solo en móvil (md:pb-0 lo cancela). */}
        <main
          id="main-content"
          tabIndex={-1}
          className={`${IS_NATIVE_APP ? 'w-full overflow-x-hidden' : 'flex-1 min-w-0'} min-h-screen pb-[calc(var(--barra-alto)+env(safe-area-inset-bottom,0px))] ${IS_NATIVE_APP ? '' : 'md:pb-0'} focus:outline-none`}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — en la app nativa siempre visible; en la web se
          oculta en escritorio (md:hidden). Misma razón que el <header>.
          Ancho: en la app lo fija --layout-w (Samsung S23); en la web es
          `w-full` + `left-0 right-0`, así llena el 100% de CUALQUIER pantalla
          (sin ellos la barra `fixed` se encoge a su contenido y queda cortada).
          Esquinas de ARRIBA redondeadas, como el encabezado lleva las de abajo. */}
      <nav data-esq="nav-inferior"
        aria-label="Navegación principal"
        style={IS_NATIVE_APP ? { width: 'var(--layout-w)' } : undefined}
        className={`${IS_NATIVE_APP ? '' : 'w-full right-0 md:hidden'} fixed bottom-0 left-0 z-30 bg-surface-card rounded-t-card shadow-barra-sup safe-bottom`}
      >
        {/* Estándar de espaciado: px-2 en la barra y px-1 py-2 gap-1 por botón
            (misma escala que el resto de la app). Cuatro botones iguales
            (flex-1); el de perfil va al final, a la derecha, con la foto. */}
        <div data-esq="nav-inferior-fila" className="flex px-2 h-[var(--barra-alto)]">
          <NavLink to="/dashboard" className={NAV_ITEM}>
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><LayoutDashboard size={24} /></span>
              <span>Asignaturas</span>
            </>)}
          </NavLink>
          <NavLink to="/calendario" className={NAV_ITEM}>
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><CalendarDays size={24} /></span>
              <span>Horario</span>
            </>)}
          </NavLink>
          <NavLink to="/notificaciones" className={NAV_ITEM}>
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><Bell size={24} /></span>
              <span>Notificaciones</span>
            </>)}
          </NavLink>
          {/* Perfil: solo la foto (sin texto) para que sea más grande; su nombre
              accesible es aria-label. justify-center la centra en la altura de
              la barra, igual que los iconos con etiqueta de al lado. */}
          <NavLink to="/profile" aria-label="Perfil" className={(e) => `${NAV_ITEM(e)} justify-center`}>
            {({ isActive }) => (
              <span className={navIconPillCls(isActive)}>
                <AvatarNav foto={userProfile?.photoURL} nombre={teacherDisplayName(userProfile)} activo={isActive} />
              </span>
            )}
          </NavLink>
        </div>
      </nav>

      {/* Confirmación de cierre de sesión — solo en la app nativa */}
      {confirmLogout && (
        <ConfirmModal
          title="Cerrar sesión"
          message="¿Seguro que quieres salir?"
          confirmLabel="Salir"
          onConfirm={handleLogout}
          onCancel={() => setConfirmLogout(false)}
        />
      )}

      {/* CTA del candado de descarga (exportGuard.js): se abre solo, sin que
          el docente tenga que ir a buscar el botón de créditos. */}

    </div>
  )
}
