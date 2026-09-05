import { useState, useEffect } from 'react'
import {
  Copy, Check, Trash2, Upload, Link2, Link2Off, Smartphone,
  Download, ChevronDown, ChevronUp, QrCode, RotateCcw, AlertTriangle, Cog, ExternalLink,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { Button, Input, Checkbox } from '../../../components/ui'
import { uploadToCloudinary } from '../../../utils/cloudinary'
import { exportAppQRPDF } from '../../../utils/pdf'
import { apiUrl } from '../../../utils/apiBase'
import { auth } from '../../../firebase'
import { APP_DOWNLOAD_URL } from '../../../config/appDownload'
import {
  listarLinks, crearLink, borrarLink, cambiarActivo,
  generarSlug, urlPublica, usarComoVigente, fechaCorta, LINK_LEGADO,
} from '../../../utils/descargaLinks'

function estadoDe(l) {
  if (l.activo === false) return 'desactivada'
  if (l.produccion) return 'vigente'
  return 'anterior'
}

function fechaMostrar(l) {
  return l.fecha || fechaCorta(l.createdAt)
}

function BadgeEstado({ estado }) {
  if (estado === 'vigente') {
    return (
      <span className="inline-flex items-center rounded-pill bg-emerald-50 text-emerald-700 text-xs font-bold px-2 py-0.5">
        Vigente
      </span>
    )
  }
  if (estado === 'desactivada') {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-slate-100 text-slate-500 text-xs font-semibold px-2 py-0.5">
        <Link2Off size={11} />
        Desactivada
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-pill bg-slate-100 text-slate-500 text-xs font-semibold px-2 py-0.5">
      Anterior
    </span>
  )
}

function BotonCopiar({ texto }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <Button
      variant="icon"
      onClick={() => {
        navigator.clipboard.writeText(texto)
        setCopiado(true)
        setTimeout(() => setCopiado(false), 2000)
      }}
      title="Copiar enlace directo"
      aria-label="Copiar enlace"
    >
      {copiado ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
    </Button>
  )
}

function ConfirmarAccion({ mensaje, labelSi = 'Sí', colorSi = 'bg-red-600 hover:bg-red-700', onSi, onNo, loading }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-on-surface flex-wrap">
      <span className="font-medium">{mensaje}</span>
      <button
        type="button"
        onClick={onSi}
        disabled={loading}
        className={`px-2 py-0.5 ${colorSi} text-white text-xs rounded disabled:opacity-60 transition-colors`}
      >
        {labelSi}
      </button>
      <button
        type="button"
        onClick={onNo}
        className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded hover:bg-slate-200 transition-colors"
      >
        Cancelar
      </button>
    </span>
  )
}

export default function DownloadLinks() {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [links, setLinks] = useState([])
  const [cargando, setCargando] = useState(true)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [descargandoPDF, setDescargandoPDF] = useState(false)

  // Formulario
  const [version, setVersion] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [marcarVigente, setMarcarVigente] = useState(true)
  const [mostrarUrlManual, setMostrarUrlManual] = useState(false)
  const [urlManual, setUrlManual] = useState('')
  const [creando, setCreando] = useState(false)

  // Compilación automática desde GitHub Actions.
  const [compilando, setCompilando] = useState(false)
  const [versionAuto, setVersionAuto] = useState('')

  // Estados de acciones en el historial
  const [accionando, setAccionando] = useState(null)
  const [pendingVigente, setPendingVigente] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const vigente = links.find((l) => l.produccion === true && l.activo !== false) || null

  useEffect(() => {
    let vivo = true
    listarLinks()
      .then((res) => { if (vivo) setLinks(res) })
      .catch(() => { if (vivo) toast('No se pudo cargar el historial', 'error') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
    // Solo al montar; el historial se actualiza en memoria al crear/borrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelado = false
    import('qrcode').then((mod) => {
      return mod.default.toDataURL(APP_DOWNLOAD_URL, { width: 600, margin: 1 })
    }).then((dataUrl) => {
      if (!cancelado) setQrDataUrl(dataUrl)
    }).catch(() => {})
    return () => { cancelado = true }
  }, [])


  // Pide a GitHub Actions que compile y publique una versión nueva. El panel
  // no espera a que termine: la compilación tarda varios minutos y dejar la
  // pestaña bloqueada no aporta nada — se manda al registro de Actions.
  async function handleCompilar() {
    setCompilando(true)
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/admin/release-apk'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionName: versionAuto.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la compilación')
      toast('Compilación iniciada — tarda unos minutos', 'success')
      setVersionAuto('')
      if (data.seguimiento) window.open(data.seguimiento, '_blank', 'noopener')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setCompilando(false)
    }
  }

  async function handlePublicar(e) {
    e.preventDefault()
    if (!version.trim()) {
      toast('Escribe la versión antes de publicar', 'error')
      return
    }
    if (!archivo && !urlManual.trim()) {
      toast('Selecciona un archivo APK o usa una URL directa', 'error')
      return
    }
    setCreando(true)
    try {
      let url = urlManual.trim()
      let fileName = null
      if (archivo) {
        url = await uploadToCloudinary(archivo, 'evalua-facil/apk')
        fileName = archivo.name
      }
      const nuevo = await crearLink({
        slug: generarSlug(),
        version: version.trim(),
        url,
        fileName,
        produccion: marcarVigente,
        createdBy: currentUser?.email || null,
      })
      setLinks((prev) => {
        const base = marcarVigente
          ? prev.map((l) => ({ ...l, produccion: false }))
          : prev
        return [nuevo, ...base]
      })
      setVersion('')
      setArchivo(null)
      setFileKey((k) => k + 1)
      setUrlManual('')
      setMostrarUrlManual(false)
      setMarcarVigente(true)
      toast(
        marcarVigente
          ? `v${nuevo.version} publicada y marcada como vigente. El QR descarga esta versión.`
          : `v${nuevo.version} añadida al historial.`
      )
    } catch (err) {
      toast(
        /apk/i.test(err?.message || '')
          ? 'Cloudinary rechazó el .apk. Permite esa extensión en el preset, o usa la opción de URL directa.'
          : 'No se pudo publicar el APK',
        'error'
      )
    } finally {
      setCreando(false)
    }
  }

  async function handleUsarComoVigente(slug) {
    setAccionando(slug)
    setPendingVigente(null)
    try {
      await usarComoVigente(slug)
      const l = links.find((x) => x.slug === slug)
      setLinks((prev) => prev.map((x) => ({
        ...x,
        produccion: x.slug === slug,
        activo: x.slug === slug ? true : x.activo,
      })))
      toast(`v${l?.version} es ahora la versión vigente. El QR descarga esta versión.`)
    } catch {
      toast('No se pudo cambiar la versión vigente', 'error')
    } finally {
      setAccionando(null)
    }
  }

  async function handleDesactivar(slug) {
    setAccionando(slug)
    try {
      await cambiarActivo(slug, false)
      setLinks((prev) => prev.map((l) => l.slug === slug ? { ...l, activo: false } : l))
      toast('Versión desactivada. El enlace ya no está disponible.')
    } catch {
      toast('No se pudo desactivar la versión', 'error')
    } finally {
      setAccionando(null)
    }
  }

  async function handleReactivar(slug) {
    setAccionando(slug)
    try {
      await cambiarActivo(slug, true)
      setLinks((prev) => prev.map((l) => l.slug === slug ? { ...l, activo: true } : l))
      toast('Versión reactivada.')
    } catch {
      toast('No se pudo reactivar la versión', 'error')
    } finally {
      setAccionando(null)
    }
  }

  async function handleEliminar(slug) {
    setAccionando(slug)
    setPendingDelete(null)
    try {
      await borrarLink(slug)
      setLinks((prev) => prev.filter((l) => l.slug !== slug))
      toast('Versión eliminada del historial.')
    } catch {
      toast('No se pudo eliminar la versión', 'error')
    } finally {
      setAccionando(null)
    }
  }

  async function handleDescargarPDF() {
    setDescargandoPDF(true)
    try {
      await exportAppQRPDF({ url: APP_DOWNLOAD_URL })
    } catch (err) {
      toast('No se pudo generar el PDF: ' + err.message, 'error')
    } finally {
      setDescargandoPDF(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Versión vigente + QR ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <QrCode size={18} className="text-accent" />
          Versión vigente
        </h2>

        {cargando ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : vigente ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-light text-accent text-sm font-bold px-3 py-1">
                <Smartphone size={13} />
                {vigente.version}
              </span>
              <span className="text-sm text-muted">{fechaMostrar(vigente)}</span>
            </div>
            <p className="text-xs text-emerald-700 font-medium mt-1.5">
              ✓ El QR descarga esta versión
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-sm text-amber-700">
            <AlertTriangle size={15} className="flex-none" />
            Sin versión vigente — el QR no funcionará hasta que publiques una.
          </div>
        )}

        {/* QR permanente */}
        <div className="mt-5 pt-5 border-t border-outline-variant">
          <p className="text-sm font-semibold text-on-surface">Código QR de descarga</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-5 items-start">
            <div className="flex-none">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Código QR de descarga de Evalúa Fácil"
                  className="w-40 h-40 rounded border border-outline-variant"
                />
              ) : (
                <div className="w-40 h-40 flex items-center justify-center bg-slate-50 rounded border border-outline-variant">
                  <Spinner />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-muted break-all">{APP_DOWNLOAD_URL}</p>
              <p className="text-xs text-muted mt-2 leading-relaxed">
                Este código QR siempre descarga la versión vigente.<br />
                No cambia cuando publicas una nueva versión.
              </p>
              <button
                type="button"
                onClick={handleDescargarPDF}
                disabled={descargandoPDF || !qrDataUrl}
                className="mt-3 flex items-center gap-1.5 text-sm text-accent hover:underline disabled:opacity-60 transition-opacity"
              >
                {descargandoPDF ? <Spinner size="sm" /> : <Download size={15} />}
                Descargar QR en PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Generar una versión automáticamente ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Cog size={18} className="text-accent" />
          Generar versión automáticamente
        </h2>
        <p className="text-sm text-muted mt-1">
          Compila el APK desde el código de <code>main</code>, lo publica y deja el
          enlace de descarga apuntando a él. No hay que subir ningún archivo.
        </p>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <Input
            id="dl-version-auto"
            label="Versión"
            optional
            value={versionAuto}
            onChange={(e) => setVersionAuto(e.target.value)}
            placeholder="1.0.7"
            hint="Vacío = sube sola el último dígito"
            wrapperClassName="flex-1 min-w-0"
          />
          <Button onClick={handleCompilar} busy={compilando} disabled={compilando}>
            <Cog size={17} />
            {compilando ? 'Iniciando…' : 'Compilar y publicar'}
          </Button>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
          <ExternalLink size={13} className="flex-shrink-0 mt-0.5" />
          Tarda unos minutos. Al iniciar se abre el registro de la compilación en
          otra pestaña; el enlace de descarga cambia solo cuando termina.
        </p>
      </div>

      {/* ── Publicar nueva versión ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Upload size={18} className="text-accent" />
          Publicar nueva versión
        </h2>
        <p className="text-sm text-muted mt-1">
          Sube el APK generado en Android Studio para distribuirlo a través del QR.
        </p>

        <form onSubmit={handlePublicar} className="mt-4 space-y-4">
          <Input
            id="dl-version"
            label="Versión"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.7"
            hint="Debe coincidir con el versionName del build de Android."
          />

          <Input
            key={fileKey}
            id="dl-archivo"
            label="Archivo APK"
            type="file"
            accept=".apk"
            onChange={(e) => setArchivo(e.target.files?.[0] || null)}
            className="file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:text-sm file:font-semibold"
          />

          <Checkbox
            label="Marcar como versión vigente"
            hint="El QR descargará esta versión en cuanto se publique."
            checked={marcarVigente}
            onChange={(e) => setMarcarVigente(e.target.checked)}
          />

          {/* URL manual — colapsada por defecto */}
          <div>
            <button
              type="button"
              onClick={() => setMostrarUrlManual((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted hover:text-on-surface transition-colors"
            >
              {mostrarUrlManual ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              ¿Problemas al subir el archivo? Usar una URL directa
            </button>
            {mostrarUrlManual && (
              <Input
                id="dl-url"
                label="URL del APK"
                value={urlManual}
                onChange={(e) => setUrlManual(e.target.value)}
                placeholder="https://…/evalua-facil.apk"
                hint="Se ignora si seleccionaste un archivo arriba."
                wrapperClassName="mt-3"
              />
            )}
          </div>

          <Button type="submit" busy={creando}>
            <Upload size={16} />
            {creando ? 'Publicando…' : 'Publicar APK'}
          </Button>
        </form>
      </div>

      {/* ── Historial ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Link2 size={18} className="text-accent" />
          Historial de versiones
        </h2>

        {cargando ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted mt-4">
            Todavía no hay versiones publicadas desde este panel.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-outline-variant">
            {links.map((l) => {
              const estado = estadoDe(l)
              const esVigente = estado === 'vigente'
              const estaDesactivada = estado === 'desactivada'
              const loading = accionando === l.slug
              const confirmandoVigente = pendingVigente === l.slug
              const confirmandoDelete = pendingDelete === l.slug

              return (
                <li key={l.slug} className="py-3 first:pt-1 last:pb-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-semibold text-sm ${esVigente ? 'text-on-surface' : 'text-muted'}`}>
                          v{l.version}
                        </span>
                        <BadgeEstado estado={estado} />
                      </div>
                      <p className="text-xs text-muted mt-0.5">{fechaMostrar(l)}</p>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* Copiar enlace — siempre disponible */}
                      <BotonCopiar texto={urlPublica(l.slug)} />

                      {/* Usar como vigente — versiones anteriores activas */}
                      {!esVigente && !estaDesactivada && (
                        confirmandoVigente ? (
                          <ConfirmarAccion
                            mensaje={`¿Usar v${l.version} como vigente?`}
                            labelSi="Sí"
                            colorSi="bg-emerald-600 hover:bg-emerald-700"
                            onSi={() => handleUsarComoVigente(l.slug)}
                            onNo={() => setPendingVigente(null)}
                            loading={loading}
                          />
                        ) : (
                          <Button
                            variant="icon"
                            onClick={() => { setPendingDelete(null); setPendingVigente(l.slug) }}
                            disabled={loading}
                            title={`Usar v${l.version} como versión vigente`}
                            aria-label="Usar como vigente"
                          >
                            <RotateCcw size={16} />
                          </Button>
                        )
                      )}

                      {/* Desactivar — versiones anteriores activas */}
                      {!esVigente && !estaDesactivada && !confirmandoVigente && (
                        <Button
                          variant="icon"
                          onClick={() => handleDesactivar(l.slug)}
                          disabled={loading}
                          title="Desactivar versión"
                          aria-label="Desactivar"
                          className="hover:text-amber-600 hover:bg-amber-50"
                        >
                          <Link2Off size={16} />
                        </Button>
                      )}

                      {/* Reactivar — versiones desactivadas */}
                      {estaDesactivada && (
                        <Button
                          variant="icon"
                          onClick={() => handleReactivar(l.slug)}
                          disabled={loading}
                          title="Reactivar versión"
                          aria-label="Reactivar"
                        >
                          <Link2 size={16} />
                        </Button>
                      )}

                      {/* Eliminar — solo versiones desactivadas */}
                      {estaDesactivada && (
                        confirmandoDelete ? (
                          <ConfirmarAccion
                            mensaje="¿Eliminar versión?"
                            onSi={() => handleEliminar(l.slug)}
                            onNo={() => setPendingDelete(null)}
                            loading={loading}
                          />
                        ) : (
                          <Button
                            variant="icon"
                            onClick={() => { setPendingVigente(null); setPendingDelete(l.slug) }}
                            disabled={loading}
                            className="hover:text-red-500 hover:bg-red-50"
                            title="Eliminar versión"
                            aria-label="Eliminar"
                          >
                            <Trash2 size={16} />
                          </Button>
                        )
                      )}

                      {loading && <Spinner size="sm" />}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* LINK_LEGADO — aviso informativo mientras siga activo */}
        {LINK_LEGADO.activo && (
          <div className="mt-5 flex gap-2 bg-amber-50 border border-amber-200 rounded p-3">
            <AlertTriangle size={14} className="text-amber-600 flex-none mt-0.5" />
            <p className="text-xs text-amber-900 leading-relaxed">
              El enlace de la versión {LINK_LEGADO.version} (agosto 2026) sigue activo y puede estar
              circulando. Cuando todos los estudiantes tengan la nueva APK instalada, puede retirarse
              editando el código.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
