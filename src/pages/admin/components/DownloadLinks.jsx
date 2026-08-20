import { useState, useEffect } from 'react'
import {
  Copy, Check, Trash2, Upload, Plus, Link2, Link2Off, Smartphone, AlertTriangle, BadgeCheck,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { Button, Input, Checkbox } from '../../../components/ui'
import { uploadToCloudinary } from '../../../utils/cloudinary'
import {
  listarLinks, crearLink, borrarLink, cambiarActivo, generarSlug, urlPublica, LINK_LEGADO,
} from '../../../utils/descargaLinks'

function hoyLargo() {
  return new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Botón de copiar que confirma en el propio botón durante 2 s. Sin toast:
// copiar es una acción menor y el toast interrumpe más de lo que informa.
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
      title="Copiar enlace"
      aria-label="Copiar enlace"
    >
      {copiado ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} />}
    </Button>
  )
}

export default function DownloadLinks() {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [links, setLinks] = useState([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [borrando, setBorrando] = useState(null)

  const [version, setVersion] = useState('')
  const [fecha, setFecha] = useState(hoyLargo())
  const [archivo, setArchivo] = useState(null)
  const [urlManual, setUrlManual] = useState('')
  const [produccion, setProduccion] = useState(false)

  useEffect(() => {
    let vivo = true
    listarLinks()
      .then((res) => { if (vivo) setLinks(res) })
      .catch(() => { if (vivo) toast('No se pudo cargar el historial de enlaces', 'error') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
    // Solo al montar: el historial se refresca en memoria al crear/borrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCrear(e) {
    e.preventDefault()
    if (!version.trim() || !fecha.trim()) return
    if (!archivo && !urlManual.trim()) {
      toast('Sube el APK o pega la URL de un archivo ya subido', 'error')
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
        fecha: fecha.trim(),
        url,
        fileName,
        produccion,
        createdBy: currentUser?.email || null,
      })
      setLinks((prev) => [nuevo, ...prev])
      setVersion('')
      setFecha(hoyLargo())
      setArchivo(null)
      setUrlManual('')
      setProduccion(false)
      toast('Enlace creado')
    } catch (err) {
      // El caso frecuente: Cloudinary rechaza la extensión .apk si el preset
      // no la tiene permitida. Se dice explícito para no mandar a nadie a
      // adivinar en los logs.
      toast(
        /apk/i.test(err?.message || '')
          ? 'Cloudinary rechazó el .apk. Permite esa extensión en tu preset de Cloudinary, o sube el archivo aparte y pega su URL.'
          : 'No se pudo crear el enlace',
        'error'
      )
    } finally {
      setCreando(false)
    }
  }

  async function handleBorrar(slug) {
    setBorrando(slug)
    try {
      await borrarLink(slug)
      setLinks((prev) => prev.filter((l) => l.slug !== slug))
      toast('Enlace borrado')
    } catch {
      toast('No se pudo borrar el enlace', 'error')
    } finally {
      setBorrando(null)
    }
  }

  async function handleActivo(slug, activo) {
    try {
      await cambiarActivo(slug, activo)
      setLinks((prev) => prev.map((l) => (l.slug === slug ? { ...l, activo } : l)))
    } catch {
      toast('No se pudo cambiar el estado del enlace', 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Crear ── */}
      <form onSubmit={handleCrear} className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Plus size={18} className="text-accent" />
          Nuevo enlace de descarga
        </h2>
        <p className="text-sm text-muted mt-1">
          Genera un enlace con un código impredecible. Solo quien lo tenga puede abrirlo.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Input
            id="dl-version"
            label="Versión"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.3"
          />
          <Input
            id="dl-fecha"
            label="Fecha (se muestra en grande)"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        <Input
          id="dl-archivo"
          label="Archivo APK"
          type="file"
          accept=".apk"
          onChange={(e) => setArchivo(e.target.files?.[0] || null)}
          wrapperClassName="mt-4"
          className="file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:text-sm file:font-semibold"
        />

        <Checkbox
          label="Es la versión que se envió a producción"
          hint="Añade el distintivo “Versión de producción” en la página de descarga."
          checked={produccion}
          onChange={(e) => setProduccion(e.target.checked)}
          wrapperClassName="mt-4"
        />

        <Input
          id="dl-url"
          label="…o pega la URL de un APK ya subido"
          value={urlManual}
          onChange={(e) => setUrlManual(e.target.value)}
          placeholder="https://…/evalua-facil.apk"
          hint="Úsalo si Cloudinary rechaza el archivo. Se ignora cuando subes un APK arriba."
          wrapperClassName="mt-4"
        />

        <Button type="submit" busy={creando} className="mt-5">
          <Upload size={18} />
          {creando ? 'Subiendo…' : 'Generar enlace'}
        </Button>
      </form>

      {/* ── Historial ── */}
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
          <Link2 size={18} className="text-accent" />
          Historial de enlaces
        </h2>

        {cargando ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted mt-4">
            Todavía no hay enlaces generados desde aquí.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {links.map((l) => (
              <li
                key={l.slug}
                className="border border-outline-variant rounded p-3 flex flex-wrap items-center gap-3"
              >
                <div className="flex-1 min-w-[12rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-pill bg-accent-light text-accent text-xs font-bold px-2 py-0.5">
                      <Smartphone size={12} />
                      {l.version}
                    </span>
                    <span className="text-sm text-on-surface font-medium">{l.fecha}</span>
                    {l.produccion && (
                      <span className="inline-flex items-center gap-1 rounded-pill bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5">
                        <BadgeCheck size={12} />
                        Producción
                      </span>
                    )}
                    {l.activo === false && (
                      <span className="inline-flex items-center gap-1 rounded-pill bg-slate-100 text-slate-500 text-xs font-semibold px-2 py-0.5">
                        <Link2Off size={12} />
                        Desactivado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 break-all">{urlPublica(l.slug)}</p>
                  {l.createdBy && (
                    <p className="text-xs text-slate-400 mt-0.5">Creado por {l.createdBy}</p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <BotonCopiar texto={urlPublica(l.slug)} />
                  <Button
                    variant="icon"
                    onClick={() => handleActivo(l.slug, l.activo === false)}
                    title={l.activo === false ? 'Reactivar enlace' : 'Desactivar enlace'}
                    aria-label={l.activo === false ? 'Reactivar enlace' : 'Desactivar enlace'}
                  >
                    {l.activo === false ? <Link2 size={18} /> : <Link2Off size={18} />}
                  </Button>
                  <Button
                    variant="icon"
                    onClick={() => handleBorrar(l.slug)}
                    disabled={borrando === l.slug}
                    className="hover:text-red-500 hover:bg-red-50"
                    title="Borrar enlace"
                    aria-label="Borrar enlace"
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* El link original no vive en Firestore, así que no se puede borrar
            desde aquí — se anota para que no parezca que se perdió. */}
        <div className="mt-5 flex gap-3 bg-amber-50 border border-amber-200 rounded p-3">
          <AlertTriangle size={16} className="text-amber-600 flex-none mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            El enlace original <span className="font-mono">{LINK_LEGADO.slug}</span> (versión{' '}
            {LINK_LEGADO.version}) está escrito en el código, no aquí, así que no aparece en esta
            lista ni se puede desactivar desde el panel. Para retirarlo hay que quitarlo del código.
          </p>
        </div>
      </div>
    </div>
  )
}
