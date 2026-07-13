import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Bell, Plus, Archive, ChevronDown, ChevronRight, LogOut, X, ArrowLeft, Camera,
} from 'lucide-react'
import EFLogo from './EFLogo'
import SubjectIcon from './SubjectIcon'
import Spinner from './Spinner'
import { subjectDisplayName } from '../utils/subjectName'

// Interruptor simple (mismo patrón visual que el resto de la app: pista
// h-6 w-11 rounded-full, pulgar h-4 w-4 — ver PaymentConfig.jsx).
function Toggle({ checked, onChange, label, description }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-2.5 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface">{label}</p>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-accent' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}

const NOTIF_DEFAULTS = { actividadesNuevas: true, calificaciones: true, recordatorios: true }

// Menú móvil del alumno — se abre al tocar el ícono de Evalúa Fácil en la
// barra superior. Ícono (toca para ver el logo completo) → foto + nombre →
// Notificaciones → Mis asignaturas (+ unirme a otra) → archivadas → Cerrar
// sesión, con una raya visible entre cada sección.
export default function StudentMenu({
  open, onClose, firstName, photoURL, uploadingPhoto, initials, onPhotoClick,
  subjects, loadingSidebar, notifPrefs, onSaveNotifPrefs, joinPrefillUsername, onLogout,
}) {
  const navigate = useNavigate()
  const [screen, setScreen] = useState('menu') // 'menu' | 'notif' | 'join'
  const [showArchived, setShowArchived] = useState(false)
  const [showFullLogo, setShowFullLogo] = useState(false)
  const [prefs, setPrefs] = useState({ ...NOTIF_DEFAULTS, ...notifPrefs })
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [joinCode, setJoinCode] = useState('')

  if (!open) return null

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  function close() {
    setScreen('menu')
    onClose()
  }

  async function togglePref(key, value) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setSavingPrefs(true)
    try {
      await onSaveNotifPrefs(next)
    } finally {
      setSavingPrefs(false)
    }
  }

  function handleJoin(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    close()
    navigate(`/activate/${code}`, { state: { prefillUsername: joinPrefillUsername } })
  }

  const dividerCls = 'border-t-2 border-outline-variant'

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={close}
        aria-label="Cerrar menú"
      />
      <div className="absolute inset-y-0 left-0 h-full w-[82vw] max-w-xs bg-surface-card shadow-2xl flex flex-col overflow-hidden">
        {screen === 'menu' && (
          <>
            {/* Ícono a la izquierda (toca para ver el logo completo) + cerrar menú */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setShowFullLogo((v) => !v)}
                  aria-label="Ver logo de Evalúa Fácil"
                  className="rounded flex-shrink-0"
                >
                  <EFLogo subtitle={false} className="w-10 h-10" />
                </button>
                <div className="flex-1" />
                <button type="button" onClick={close} aria-label="Cerrar menú" className="p-1 -mr-1 text-muted hover:text-on-surface rounded flex-shrink-0">
                  <X size={20} />
                </button>
              </div>

              {/* Foto/avatar a la izquierda, nombre (sin apellidos) a la derecha */}
              <div className={`flex items-center gap-3 px-4 pb-4 ${dividerCls}`}>
                <button
                  type="button"
                  onClick={onPhotoClick}
                  className="relative w-11 h-11 rounded-full flex-shrink-0 group focus:outline-none"
                  data-tooltip="Cambiar foto"
                  aria-label="Cambiar foto"
                >
                  <div className="w-11 h-11 rounded-full bg-accent-tint overflow-hidden flex items-center justify-center">
                    {uploadingPhoto ? (
                      <Spinner size="sm" />
                    ) : photoURL ? (
                      <img src={photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-base font-bold text-accent">{initials}</span>
                    )}
                  </div>
                  <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <Camera size={16} className="text-white" />
                  </span>
                </button>
                <p className="flex-1 min-w-0 font-semibold text-on-surface truncate">{firstName}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Notificaciones */}
              <button
                type="button"
                onClick={() => setScreen('notif')}
                className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent-tint transition-colors ${dividerCls}`}
              >
                <Bell size={20} className="text-accent flex-shrink-0" />
                <span className="font-medium text-on-surface flex-1 text-left">Notificaciones</span>
                <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
              </button>

              {/* Asignaturas */}
              <div className="px-2 py-2">
                <p className="px-3 pt-1 pb-1 text-label-caps text-muted uppercase">Mis asignaturas</p>
                {loadingSidebar ? (
                  <div className="flex justify-center py-3"><Spinner size="sm" /></div>
                ) : activeSubjects.length === 0 ? (
                  <p className="text-sm text-muted px-3 py-2">Sin asignaturas aún</p>
                ) : (
                  activeSubjects.map((s) => (
                    <NavLink
                      key={s.id}
                      to={`/alumno/materia/${s.id}`}
                      onClick={close}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                          isActive ? 'bg-accent-tint text-accent font-semibold' : 'text-on-surface hover:bg-accent-tint'
                        }`
                      }
                    >
                      <SubjectIcon iconKey={s.icon} size={18} className="flex-shrink-0" />
                      <span className="truncate">{subjectDisplayName(s)}</span>
                    </NavLink>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setScreen('join')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium text-accent hover:bg-accent-tint transition-colors mt-1"
                >
                  <Plus size={17} className="flex-shrink-0" />
                  Unirme a otra asignatura
                </button>
              </div>

              <div className={dividerCls} />

              {/* Archivadas */}
              <div className="px-2 py-2">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm text-muted hover:bg-accent-tint transition-colors"
                >
                  <Archive size={16} className="flex-shrink-0" />
                  <span className="flex-1 text-left">Asignaturas archivadas{archivedSubjects.length > 0 ? ` (${archivedSubjects.length})` : ''}</span>
                  <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
                </button>
                {showArchived && (
                  archivedSubjects.length === 0 ? (
                    <p className="text-xs text-muted px-3 py-2">No tienes asignaturas archivadas.</p>
                  ) : (
                    archivedSubjects.map((s) => (
                      <NavLink
                        key={s.id}
                        to={`/alumno/materia/${s.id}`}
                        onClick={close}
                        className="flex items-center gap-2.5 px-3 py-2 rounded text-sm text-muted hover:bg-accent-tint transition-colors"
                      >
                        <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                        <span className="truncate">{subjectDisplayName(s)}</span>
                      </NavLink>
                    ))
                  )
                )}
              </div>
            </div>

            {/* Cerrar sesión — siempre hasta abajo */}
            <div className="border-t border-outline-variant px-2 py-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => { close(); onLogout() }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-sm font-medium text-error hover:bg-red-50 transition-colors"
              >
                <LogOut size={18} className="flex-shrink-0" />
                Cerrar sesión
              </button>
            </div>
          </>
        )}

        {screen === 'notif' && (
          <>
            <div className="flex items-center gap-2 px-3 py-4 border-b border-outline-variant flex-shrink-0">
              <button type="button" onClick={() => setScreen('menu')} aria-label="Volver" className="p-1.5 text-muted hover:text-on-surface rounded flex-shrink-0">
                <ArrowLeft size={20} />
              </button>
              <h2 className="font-semibold text-on-surface flex-1">Notificaciones</h2>
              {savingPrefs && <Spinner size="sm" />}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-outline-variant">
              <Toggle
                checked={prefs.actividadesNuevas}
                onChange={(v) => togglePref('actividadesNuevas', v)}
                label="Actividades nuevas"
                description="Cuando tu maestro publique una actividad"
              />
              <Toggle
                checked={prefs.calificaciones}
                onChange={(v) => togglePref('calificaciones', v)}
                label="Calificaciones"
                description="Cuando te califiquen una entrega"
              />
              <Toggle
                checked={prefs.recordatorios}
                onChange={(v) => togglePref('recordatorios', v)}
                label="Recordatorios de entrega"
                description="Antes de que cierre una fecha límite"
              />
            </div>
          </>
        )}

        {screen === 'join' && (
          <>
            <div className="flex items-center gap-2 px-3 py-4 border-b border-outline-variant flex-shrink-0">
              <button type="button" onClick={() => setScreen('menu')} aria-label="Volver" className="p-1.5 text-muted hover:text-on-surface rounded flex-shrink-0">
                <ArrowLeft size={20} />
              </button>
              <h2 className="font-semibold text-on-surface flex-1">Unirme a otra asignatura</h2>
            </div>
            <form onSubmit={handleJoin} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <p className="text-sm text-muted">
                Ingresa el <strong>código de acceso</strong> de la asignatura (el que te dio tu maestro o maestra, o el del QR):
              </p>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                placeholder="Ej: A3B7K2"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Plus size={18} /> Unirme
              </button>
            </form>
          </>
        )}
      </div>

      {/* Logo completo — se abre al tocar el ícono, se cierra tocando de nuevo (aquí, en el fondo) */}
      {showFullLogo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60">
          <button
            type="button"
            className="absolute inset-0 border-none cursor-default"
            onClick={() => setShowFullLogo(false)}
            aria-label="Cerrar logo"
          />
          <EFLogo className="relative w-64 sm:w-80 h-auto pointer-events-none" />
        </div>
      )}
    </div>
  )
}
