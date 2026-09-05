import { useState, useEffect } from 'react'
import {
  Copy, Check, Link2, Link2Off, Smartphone,
  Download, QrCode, RotateCcw, AlertTriangle, Cog, ExternalLink,
} from 'lucide-react'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { Button, Input } from '../../../components/ui'
import { exportAppQRPDF } from '../../../utils/pdf'
import { apiUrl } from '../../../utils/apiBase'
import { auth } from '../../../firebase'
import { APP_DOWNLOAD_URL } from '../../../config/appDownload'
import {
  listarLinks, urlPublica, usarComoVigente, fechaCorta, LINK_LEGADO,
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
  const toast = useToast()

  const [links, setLinks] = useState([])
  const [cargando, setCargando] = useState(true)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [descargandoPDF, setDescargandoPDF] = useState(false)

  // Formulario

  // Compilación automática desde GitHub Actions.
  const [compilando, setCompilando] = useState(false)
  const [versionAuto, setVersionAuto] = useState('')

  // Estados de acciones en el historial
  const [accionando, setAccionando] = useState(null)
  const [pendingVigente, setPendingVigente] = useState(null)

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

      {/* ── Publicar una versión nueva ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Cog size={18} className="text-accent" />
          Publicar una versión nueva
        </h2>
        <p className="text-sm text-muted mt-1">
          Compila el APK desde el código más reciente y lo publica. El enlace que
          ya circula entre los docentes y el código QR pasan a entregar esta versión
          — no hay que repartir nada nuevo.
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
              const loading = accionando === l.slug
              const confirmandoVigente = pendingVigente === l.slug

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

                    {/* Acciones — solo las dos que se usan de verdad:
                        copiar el enlace de una versión concreta, y volver a
                        una anterior si la recién publicada salió mal.
                        Desactivar, reactivar y eliminar se quitaron: el
                        historial es un registro de qué se publicó y cuándo,
                        no un archivero que haya que mantener. */}
                    <div className="flex items-center gap-1">
                      <BotonCopiar texto={urlPublica(l.slug)} />

                      {!esVigente && (
                        confirmandoVigente ? (
                          <ConfirmarAccion
                            mensaje={`¿Volver a la v${l.version}?`}
                            labelSi="Sí"
                            colorSi="bg-emerald-600 hover:bg-emerald-700"
                            onSi={() => handleUsarComoVigente(l.slug)}
                            onNo={() => setPendingVigente(null)}
                            loading={loading}
                          />
                        ) : (
                          <Button
                            variant="icon"
                            onClick={() => setPendingVigente(l.slug)}
                            disabled={loading}
                            title={`Volver a la v${l.version} — el enlace y el QR pasan a entregar esta`}
                            aria-label="Volver a esta versión"
                          >
                            <RotateCcw size={16} />
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
