import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  LogOut,
  User,
  Plus,
  Archive,
  ChevronRight,
  Timer,
  CalendarDays,
  Bell,
  Lock,
  BookOpen,
  Sparkles,
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
import Spinner from './Spinner'
import { useSubscription } from '../hooks/useSubscription'
import { getTrialBannerMessage, isSubscriptionExpired } from '../utils/subscriptionHelpers'
import { configurarBloqueoEscritura } from '../utils/firestoreGuard'
import { configurarBloqueoExportacion } from '../utils/exportGuard'
import SuscripcionVencidaModal from './SuscripcionVencidaModal'
import { subjectDisplayName } from '../utils/subjectName'
import { teacherDisplayName } from '../utils/studentSearch'
import { IS_NATIVE_APP } from '../utils/platform'
import SubjectIcon from './SubjectIcon'
import PortalBadge from './PortalBadge'
import EFLogo from './EFLogo'
import AppQRButton from './AppQRButton'
import ConfirmModal from './ConfirmModal'
import CreditosBar from './CreditosBar'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'

// Indicador de pestaña activa en la barra inferior — un rectángulo de
// esquinas ovaladas relleno de color detrás del ícono (pedido explícito,
// solo en la App; en la web móvil solo cambia de color como antes).
function navIconPillCls(isActive) {
  if (!IS_NATIVE_APP) return ''
  return `px-5 py-1 rounded-full transition-colors ${isActive ? 'bg-[var(--accent-light)]' : ''}`
}

export default function TeacherLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

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

  const { subscription, refresh: refreshSubscription } = useSubscription()
  const trialBanner = getTrialBannerMessage(subscription)

  // ── Suscripción vencida ────────────────────────────────────────────
  // Consultar y descargar sigue libre; lo que se bloquea es trabajar. El
  // candado real vive en utils/firestoreGuard.js (las pantallas del docente
  // escriben a través de él), y aquí se le dice cuándo apretar y cómo avisar.
  const vencida = isSubscriptionExpired(subscription)
  // Qué suscripción tiene la ventana cerrada "para consultar". Guardar el id
  // —en vez de un simple sí/no— hace que la ventana vuelva sola en cuanto la
  // suscripción cambia (se renovó, o llegó una nueva), sin efectos de por medio.
  const [ventanaCerradaPara, setVentanaCerradaPara] = useState(null)
  const claveSuscripcion = subscription?.id || 'sin-suscripcion'
  const paywallAbierto = vencida && ventanaCerradaPara !== claveSuscripcion

  // El guard corre fuera de React: necesita leer el valor de AHORA, no el que
  // había cuando se registró.
  const vencidaRef = useRef(vencida)
  useEffect(() => { vencidaRef.current = vencida }, [vencida])

  useEffect(() => {
    configurarBloqueoEscritura({
      vencida: () => vencidaRef.current,
      // Intentó trabajar: ese es el momento de volver a mostrarle cómo seguir.
      onIntento: () => setVentanaCerradaPara(null),
    })
    return () => configurarBloqueoEscritura({ vencida: () => false, onIntento: null })
  }, [])

  // Candado de DESCARGA (utils/exportGuard.js) — distinto del de escritura:
  // bloquea solo mientras nunca hubo un pago aprobado (planId ausente, el
  // mismo criterio que nuncaAprobado en Profile.jsx), no por venCIDA. Un
  // docente que ya pagó sigue descargando aunque se le venza después.
  const nuncaAprobadoRef = useRef(!subscription?.planId)
  useEffect(() => { nuncaAprobadoRef.current = !subscription?.planId }, [subscription?.planId])

  useEffect(() => {
    configurarBloqueoExportacion({ bloqueado: () => nuncaAprobadoRef.current })
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
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top">
        <div className="flex items-center gap-2 min-w-0">
          <EFLogo subtitle={false} className="h-8 w-auto flex-shrink-0" />
          {/* eslint-disable-next-line jsx-a11y/aria-role -- `role` aquí es la prop propia de PortalBadge, no un atributo ARIA */}
          <PortalBadge role="docente" />
        </div>
        <div className="flex items-center gap-1">
          {/* Créditos IA — visibles sin entrar a ninguna sección (chip compacto) */}
          <CreditosBar variant="movil" />
          <NavLink
            to="/manual"
            aria-label="Ayuda para comenzar"
            className="p-2 text-muted hover:text-accent rounded transition-colors"
          >
            <BookOpen size={20} />
          </NavLink>
          <button
            type="button"
            onClick={requestLogout}
            aria-label="Cerrar sesión"
            className="p-2 text-muted hover:text-error rounded transition-colors"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Desktop: sidebar + content */}
      <div className="flex">
        {/* Sidebar — desktop only (solid accent plane) */}
        <aside className="hidden md:flex flex-col w-[300px] h-screen sticky top-0 bg-accent text-white flex-shrink-0 z-20">
          {/* Logo — siempre sobre blanco: recuadro blanco sobre el azul del sidebar. */}
          <div className="px-3 pt-2 pb-1">
            <div className="bg-white rounded-card px-3 py-2.5 shadow-card">
              <EFLogo className="w-full h-auto" />
            </div>
            {/* Versión y etiqueta de rol comparten renglón: versión a la izquierda,
                rol a la derecha. La versión es solo de la web — en la app vive en
                Perfil, debajo del aviso de privacidad, y la etiqueta se queda sola. */}
            <div className="flex items-center gap-2 pt-1">
              {!IS_NATIVE_APP && (
                <p className="text-metadata text-white/50 pl-1">v.1.0.1</p>
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
            className="flex items-center gap-3 px-3 py-2 mx-2 rounded hover:bg-white/10 transition-colors group"
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

          {/* Trial status — the day counter is always visible from day 1; an amber
              notice is added only for the last stretch. Never a popup. Clicking
              goes to /profile, where the real subscription-activation flow lives. */}
          {trialBanner && (
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className={`mx-2 mt-1 px-3 py-1.5 flex items-start gap-2 rounded transition-colors text-left w-[calc(100%-1rem)] ${
                trialBanner.tone !== 'neutral' ? 'bg-amber-400/20 hover:bg-amber-400/30' : 'hover:bg-white/10'
              }`}
            >
              <Timer size={15} className="text-white/80 flex-shrink-0 mt-0.5" />
              <div className="leading-tight">
                {trialBanner.counter && (
                  <p className="text-metadata text-white/90">{trialBanner.counter}</p>
                )}
                {trialBanner.notice && (
                  <p className="text-metadata text-white/90">{trialBanner.notice}</p>
                )}
              </div>
            </button>
          )}

          {/* Horario y Agenda */}
          <NavLink
            to="/calendario"
            className={({ isActive }) =>
              `flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-card text-base font-semibold transition-colors ${
                isActive
                  ? 'bg-white text-accent shadow-card'
                  : 'bg-white/15 text-white hover:bg-white/25 ring-1 ring-white/30'
              }`
            }
          >
            <CalendarDays size={20} className="flex-shrink-0" />
            Horario y Agenda
          </NavLink>

          {/* Subjects header → goes to the full subjects list */}
          <NavLink to="/dashboard" className="mx-2 px-2 pt-3 pb-1 flex items-center justify-between rounded hover:bg-white/10 transition-colors group">
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
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loadingSidebar ? (
              <div className="flex justify-center py-3">
                <Spinner size="sm" />
              </div>
            ) : activeSubjects.length === 0 ? (
              <p className="text-body-sm text-white/70 px-3 py-2">Sin asignaturas aún</p>
            ) : (
              activeSubjects.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/subject/${s.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2.5 rounded transition-colors ${
                      isActive ? 'bg-white text-accent font-bold shadow-md' : 'text-white/90 hover:bg-white/15'
                    }`
                  }
                >
                  <SubjectIcon iconKey={s.icon} size={20} className="flex-shrink-0" />
                  {/* 14 px pedido explícito — antes text-body-sm (13.5 px, por
                      la raíz de 14.4 del proyecto). Solo el nombre de la
                      asignatura, no el resto del panel. */}
                  <span className="truncate text-[14px]">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}

            {/* Nueva asignatura */}
            <button
              type="button"
              onClick={() => navigate('/dashboard', { state: { openCreate: true } })}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium text-white hover:bg-white/10 transition-colors mt-1"
            >
              <Plus size={17} />
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
          {/* QR de descarga de la app — arriba de Notificaciones. Va aquí y no
              dentro de una asignatura porque es el MISMO para todas: la app es
              una sola y el perfil se elige al abrirla. */}
          {/* Perfil para IA del docente — arriba del QR, pedido explícito
              (FASE 2-BIS del Plan Maestro de IA). Contexto general del
              docente, se captura una sola vez y se reutiliza en todas las
              funciones de IA de sus asignaturas. */}
          <div className="px-2 pt-2 border-t border-white/15">
            <NavLink
              to="/perfil-ia"
              title="Desbloquea Config Asistente IA por asignatura"
              className={({ isActive }) =>
                `flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                }`
              }
            >
              <Sparkles size={17} className="flex-shrink-0" />
              Perfil para IA del docente
            </NavLink>
          </div>

          <div className="px-2 pt-2 border-t border-white/15">
            <AppQRButton
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium text-white/80 hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              QR para descargar la app
            </AppQRButton>
          </div>

          <div className="px-2 pt-2 border-t border-white/15">
            <NavLink
              to="/notificaciones"
              className={({ isActive }) =>
                `flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                }`
              }
            >
              <Bell size={17} className="flex-shrink-0" />
              Notificaciones
            </NavLink>
            <NavLink
              to="/manual"
              className={({ isActive }) =>
                `flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                }`
              }
            >
              <BookOpen size={17} className="flex-shrink-0" />
              Ayuda para comenzar
            </NavLink>
          </div>

          {/* Archivadas — fixed at the bottom, above logout */}
          {archivedSubjects.length > 0 && (
            <div className="px-2 pt-2 max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowArchived((a) => !a)}
                aria-expanded={showArchived}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm text-white/60 hover:bg-white/10 transition-colors"
              >
                <Archive size={15} className="flex-shrink-0" />
                <span className="flex-1 text-left">Archivadas ({archivedSubjects.length})</span>
                {/* La flecha va a la DERECHA de la palabra (pedido explícito)
                    y gira al desplegar — mismo lenguaje que un <details>, sin
                    serlo, para no perder el estilo propio del botón. */}
                <ChevronRight size={14} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-90' : ''}`} />
              </button>
              {showArchived &&
                archivedSubjects.map((s) => (
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
                      `flex items-center gap-2 pl-10 pr-3 py-2 rounded text-body-sm transition-colors ${
                        isActive ? 'bg-white text-accent font-bold shadow-md' : 'text-white/70 hover:bg-white/15'
                      }`
                    }
                  >
                    <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                    <span className="truncate">{subjectDisplayName(s)}</span>
                  </NavLink>
                ))}
            </div>
          )}

          {/* Créditos IA — barra permanente del docente (clic → panel) */}
          <CreditosBar variant="sidebar" />

          {/* Logout */}
          <div className="px-2 py-2 border-t border-white/15">
            <button
              type="button"
              onClick={requestLogout}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={17} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main content — pb reserva el alto de la barra inferior (5rem) MÁS el
            inset de seguridad de Android que ya se le suma a esa barra
            (.safe-bottom en <nav> abajo); si no, el último contenido de cada
            página queda tapado detrás de la barra, que ahora es más alta. */}
        <main className="flex-1 min-w-0 min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface-card border-t border-outline-variant safe-bottom">
        <div className="flex">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><LayoutDashboard size={24} /></span>
              <span>Asignaturas</span>
            </>)}
          </NavLink>
          <NavLink
            to="/calendario"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><CalendarDays size={24} /></span>
              <span>Horario</span>
            </>)}
          </NavLink>
          <NavLink
            to="/notificaciones"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><Bell size={24} /></span>
              <span>Notificaciones</span>
            </>)}
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><User size={24} /></span>
              <span>Perfil</span>
            </>)}
          </NavLink>
        </div>
      </nav>

      {/* Suscripción vencida: la ventana de pago y, cuando el docente la cierra
          para consultar lo suyo, el botón fijo que la vuelve a abrir. */}
      <SuscripcionVencidaModal
        open={paywallAbierto}
        subscription={subscription}
        onSoloConsultar={() => setVentanaCerradaPara(claveSuscripcion)}
        onPagado={refreshSubscription}
      />
      {vencida && !paywallAbierto && (
        <button
          type="button"
          onClick={() => setVentanaCerradaPara(null)}
          // Por encima de la barra inferior en móvil (donde existe) y pegado a
          // la esquina en escritorio.
          className="fixed right-4 bottom-20 md:bottom-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-card bg-amber-500 text-white text-sm font-semibold shadow-2xl hover:bg-amber-600 transition-colors"
        >
          <Lock size={16} /> Suscripción vencida — activar
        </button>
      )}

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

    </div>
  )
}
