// Código QR de acceso a la participación. En la SALA DE ESPERA es el protagonista: grande, centrado y cuadrado
// (entre 40 % y 55 % de la altura útil, ver ladoQr), con una zona blanca de 4 módulos alrededor, instrucción y
// código de acceso en letra grande, sobre fondo limpio de alto contraste. Una vez que inicia la actividad la
// pregunta manda: el QR se vuelve a desplegar con un control (QrSuperpuesto).
import { useEffect, useState } from 'react'
import { ladoQr, tamanosProyeccion } from '../../utils/proyeccionVivo'
import { urlParticipacion } from '../../utils/participacionVivoDb'
import Spinner from '../Spinner'

// SVG (vectorial: se ve nítido a cualquier tamaño) como data URL; corrección de errores M y margen de 4 módulos.
function useQrSvg(url) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelado = false
    import('qrcode').then((m) => m.default.toString(url, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }))
      .then((svg) => { if (!cancelado) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`) }).catch(() => {})
    return () => { cancelado = true }
  }, [url])
  return src
}

export function QrImagen({ url, lado, className = '' }) {
  const src = useQrSvg(url)
  return src
    ? <img src={src} alt={`Código QR para participar: ${url}`} width={lado} height={lado} data-qr-participacion data-qr-url={url} className={`bg-white block ${className}`} style={{ width: lado, height: lado }} />
    : <div style={{ width: lado, height: lado }} className="flex items-center justify-center"><Spinner /></div>
}

/** Pantalla de espera de la modalidad externa: QR enorme + instrucción + código. */
export default function SalaQr({ sesion, area }) {
  const url = urlParticipacion(sesion.codigo)
  const t = tamanosProyeccion(area.ancho, area.alto)
  const lado = ladoQr(area.ancho, area.alto)
  const horizontal = area.ancho >= area.alto * 1.15
  return (
    <div className={`h-full w-full flex ${horizontal ? 'flex-row' : 'flex-col'} items-center justify-center gap-[4vmin] px-[4vmin] text-slate-900`}>
      <QrImagen url={url} lado={lado} className="rounded-card border border-slate-300 flex-shrink-0" />
      <div className={horizontal ? 'text-left' : 'text-center'} style={{ maxWidth: horizontal ? area.ancho - lado - area.ancho * 0.12 : area.ancho * 0.9 }}>
        <p className="font-bold leading-tight" style={{ fontSize: t.pregunta }}>Escanea para participar</p>
        <p className="mt-[2vmin] font-semibold break-all" style={{ fontSize: t.opcion }}>{url.replace(/^https?:\/\//, '')}</p>
        <p className="mt-[3vmin] font-medium text-slate-700" style={{ fontSize: t.opcion }}>o escribe el código</p>
        <p className="font-bold tracking-widest tabular-nums leading-none mt-[1vmin]" style={{ fontSize: Math.round(t.pregunta * 1.35) }}>{sesion.codigo}</p>
      </div>
    </div>
  )
}

/** QR que se vuelve a desplegar durante la actividad con un control: grande y centrado, sin tapar la pregunta cuando se oculta. */
export function QrSuperpuesto({ sesion, area, onCerrar }) {
  const url = urlParticipacion(sesion.codigo)
  const t = tamanosProyeccion(area.ancho, area.alto)
  const lado = ladoQr(area.ancho, area.alto)
  return (
    <div className="absolute inset-0 z-barra flex flex-col items-center justify-center gap-[2vmin] text-slate-900" style={{ backgroundColor: 'rgba(255,255,255,0.97)' }}>
      <QrImagen url={url} lado={lado} className="rounded-card border border-slate-300" />
      <p className="font-bold tabular-nums tracking-widest" style={{ fontSize: t.pregunta }}>{sesion.codigo}</p>
      {onCerrar && <button type="button" onClick={onCerrar} className="rounded-full border-2 border-slate-900 px-[4vmin] py-[1.2vmin] font-semibold" style={{ fontSize: t.resto }}>Ocultar QR</button>}
    </div>
  )
}
