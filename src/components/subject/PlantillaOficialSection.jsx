// Plantilla oficial de la escuela: el docente sube el formato real de su
// plantel (Word o Excel, vacío, con su logo) y marca en pantalla qué
// casilla corresponde a qué dato — ese mapeo se guarda una vez y de ahí en
// adelante Planeación Didáctica Inicial puede generar directo en ese
// formato, en vez del Excel genérico. Ver src/utils/plantillaOficial.js
// para el detalle de cómo se lee/marca/llena cada tipo de archivo.
import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import { uploadToCloudinary } from '../../utils/cloudinary'
import {
  tipoDePlantilla, leerCuadriculaExcel, leerTablasWord, marcarCeldaWord,
} from '../../utils/plantillaOficial'
import { Upload, X, Tag, Trash2 } from 'lucide-react'

const MAX_BYTES = 8 * 1024 * 1024

function claveCelda(tablaIndex, fila, columna) {
  return tablaIndex == null ? `${fila}_${columna}` : `${tablaIndex}_${fila}_${columna}`
}

// Celda clicable — muestra el texto original de la plantilla (gris, de
// referencia) y, si ya está marcada, la etiqueta que el docente le puso.
function Celda({ texto, marcada, onClick }) {
  return (
    <td
      onClick={onClick}
      className={`border px-2 py-1 text-xs cursor-pointer align-top min-w-[90px] max-w-[160px] ${
        marcada ? 'bg-[var(--accent-tint)] border-accent' : 'border-outline-variant hover:bg-surface'
      }`}
    >
      {marcada && (
        <span className="flex items-center gap-1 text-accent font-semibold mb-0.5">
          <Tag size={10} /> {marcada}
        </span>
      )}
      <span className="text-muted line-clamp-2 break-words">{texto || <em>(vacía)</em>}</span>
    </td>
  )
}

export default function PlantillaOficialSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [plantillaOficial, setPlantillaOficial] = useState(null)
  const inputRef = useRef(null)
  const [archivo, setArchivo] = useState(null) // { nombre, tipo, buffer }
  const [tablasWord, setTablasWord] = useState(null)
  const [cuadriculaExcel, setCuadriculaExcel] = useState(null)
  const [mapeo, setMapeo] = useState([]) // [{campo, campoKey, fila, columna, tablaIndex?}]
  const [bufferEtiquetadoWord, setBufferEtiquetadoWord] = useState(null) // ArrayBuffer, solo docx
  const [celdaActiva, setCeldaActiva] = useState(null)
  const [nombreCampo, setNombreCampo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setPlantillaOficial(snap.exists() ? (snap.data().plantillaOficial || null) : null)
    }, () => setPlantillaOficial(null))
    return unsub
  }, [subjectId])

  async function onArchivoSeleccionado(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const tipo = tipoDePlantilla(file.name)
    if (!tipo) {
      toast('Sube un archivo de Word (.docx) o Excel (.xlsx) — no un documento escaneado', 'error')
      return
    }
    if (file.size > MAX_BYTES) {
      toast('El archivo pesa más de 8 MB', 'error')
      return
    }
    setCargando(true)
    try {
      const buffer = await file.arrayBuffer()
      if (tipo === 'xlsx') {
        const { filas } = await leerCuadriculaExcel(buffer)
        setCuadriculaExcel(filas)
        setTablasWord(null)
      } else {
        const tablas = await leerTablasWord(buffer)
        if (!tablas.length) {
          toast('Ese Word no tiene ninguna tabla — solo se pueden marcar casillas dentro de una tabla', 'error')
          setCargando(false)
          return
        }
        setTablasWord(tablas)
        setCuadriculaExcel(null)
        setBufferEtiquetadoWord(buffer.slice(0)) // copia — se va etiquetando conforme se marca
      }
      setArchivo({ nombre: file.name, tipo, buffer })
      setMapeo([])
    } catch (err) {
      toast('No se pudo leer el archivo: ' + err.message, 'error')
    } finally {
      setCargando(false)
    }
  }

  function abrirEtiquetado(fila, columna, tablaIndex) {
    setCeldaActiva({ fila, columna, tablaIndex })
    setNombreCampo('')
  }

  async function confirmarEtiqueta() {
    const campo = nombreCampo.trim()
    if (!campo) return
    const { fila, columna, tablaIndex } = celdaActiva
    const campoKey = `campo_${mapeo.length + 1}`
    const entrada = { campo, campoKey, fila, columna, ...(tablaIndex != null ? { tablaIndex } : {}) }

    if (archivo.tipo === 'docx') {
      try {
        const nuevoBuffer = await marcarCeldaWord(bufferEtiquetadoWord, tablaIndex, fila, columna, campoKey)
        setBufferEtiquetadoWord(nuevoBuffer)
      } catch (err) {
        toast('No se pudo marcar esa celda: ' + err.message, 'error')
        return
      }
    }
    setMapeo((prev) => [...prev, entrada])
    setCeldaActiva(null)
  }

  async function quitarEtiqueta(entrada) {
    // Al quitar una etiqueta de Word habría que des-etiquetar el XML — más
    // simple y sin riesgo de dejar el documento roto: se re-arma el buffer
    // etiquetado desde el original, re-aplicando el resto de las marcas.
    const nuevoMapeo = mapeo.filter((m) => m.campoKey !== entrada.campoKey)
    setMapeo(nuevoMapeo)
    if (archivo.tipo === 'docx') {
      let buffer = archivo.buffer.slice(0)
      for (const m of nuevoMapeo) {
        buffer = await marcarCeldaWord(buffer, m.tablaIndex, m.fila, m.columna, m.campoKey)
      }
      setBufferEtiquetadoWord(buffer)
    }
  }

  async function guardar() {
    if (!mapeo.length) {
      toast('Marca al menos una casilla antes de guardar', 'error')
      return
    }
    setGuardando(true)
    try {
      const original = new File([archivo.buffer], archivo.nombre)
      const urlOriginal = await uploadToCloudinary(original, 'evalua-facil/plantillas-oficiales')
      let urlEtiquetada = null
      if (archivo.tipo === 'docx') {
        const tagged = new File([bufferEtiquetadoWord], archivo.nombre.replace(/\.docx$/i, '.tags.docx'))
        urlEtiquetada = await uploadToCloudinary(tagged, 'evalua-facil/plantillas-oficiales')
      }
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        plantillaOficial: {
          nombre: archivo.nombre,
          tipo: archivo.tipo,
          url: urlOriginal,
          urlEtiquetada,
          mapeo: mapeo.map(({ campo, campoKey, fila, columna, tablaIndex }) => ({
            campo, campoKey, fila, columna, ...(tablaIndex != null ? { tablaIndex } : {}),
          })),
        },
      }, { merge: true })
      toast('Plantilla guardada — ya puedes generar la Planeación en este formato')
      setArchivo(null)
      setTablasWord(null)
      setCuadriculaExcel(null)
      setMapeo([])
    } catch (err) {
      toast('No se pudo guardar la plantilla: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function quitarPlantillaGuardada() {
    setGuardando(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), { docenteId, plantillaOficial: null }, { merge: true })
      toast('Plantilla oficial quitada')
    } catch (err) {
      toast('No se pudo quitar: ' + err.message, 'error')
    } finally {
      setGuardando(false)
      setConfirmarQuitar(false)
    }
  }

  const enEdicion = !!archivo
  const grid = archivo?.tipo === 'xlsx' ? [{ filas: cuadriculaExcel }] : tablasWord

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <h2 className="font-bold text-on-surface">Formato oficial de mi escuela</h2>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Sube la plantilla real de tu plantel (Word o Excel, vacía, con su logo — no un documento escaneado) y
        marca qué casilla es qué dato. La IA la vuelve a llenar en ese mismo formato en vez de un Excel genérico.
      </p>

      {!enEdicion && plantillaOficial && (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-outline-variant text-sm mb-2">
          <span className="text-on-surface">
            <strong>{plantillaOficial.nombre}</strong> · {plantillaOficial.mapeo?.length || 0} casillas marcadas
          </span>
          <button
            type="button"
            onClick={() => setConfirmarQuitar(true)}
            className="flex items-center gap-1 text-xs text-red-600 hover:underline"
          >
            <Trash2 size={12} /> Quitar
          </button>
        </div>
      )}

      {!enEdicion && (
        <>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.docx,.doc" className="hidden" onChange={onArchivoSeleccionado} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={cargando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {cargando ? <Spinner size="sm" /> : <Upload size={14} />}
            {plantillaOficial ? 'Subir otra plantilla' : 'Subir plantilla de mi escuela'}
          </button>
        </>
      )}

      {enEdicion && grid && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Haz clic en cada casilla que quieras que la IA llene y ponle un nombre corto (ej. "Tema semana 1",
            "Actividad parcial 2"). Las casillas sin marcar se dejan tal cual, con su texto/formato original.
          </p>
          {grid.map((tabla, ti) => (
            <div key={ti} className="overflow-x-auto border border-outline-variant rounded">
              {grid.length > 1 && <p className="text-xs font-medium text-muted px-2 pt-1">Tabla {ti + 1}</p>}
              <table className="border-collapse w-full">
                <tbody>
                  {tabla.filas.map((fila, fi) => (
                    <tr key={fi}>
                      {fila.map((celda, ci) => {
                        const tablaIndex = archivo.tipo === 'docx' ? ti : undefined
                        const clave = claveCelda(tablaIndex, celda.fila, celda.columna)
                        const marcada = mapeo.find((m) =>
                          claveCelda(m.tablaIndex, m.fila, m.columna) === clave
                        )
                        return (
                          <Celda
                            key={ci}
                            texto={celda.texto}
                            marcada={marcada?.campo}
                            onClick={() => marcada
                              ? quitarEtiqueta(marcada)
                              : abrirEtiquetado(celda.fila, celda.columna, tablaIndex)}
                          />
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !mapeo.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
            >
              {guardando ? <Spinner size="sm" /> : null}
              Guardar plantilla ({mapeo.length} casilla{mapeo.length === 1 ? '' : 's'} marcada{mapeo.length === 1 ? '' : 's'})
            </button>
            <button
              type="button"
              onClick={() => { setArchivo(null); setTablasWord(null); setCuadriculaExcel(null); setMapeo([]) }}
              disabled={guardando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm text-on-surface hover:bg-surface disabled:opacity-60"
            >
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {celdaActiva && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCeldaActiva(null)}>
          <div className="bg-surface-card rounded-card shadow-card p-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-on-surface mb-2">¿Qué dato va en esta casilla?</h3>
            <input
              type="text"
              autoFocus
              value={nombreCampo}
              onChange={(e) => setNombreCampo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmarEtiqueta() }}
              placeholder='Ej. "Tema semana 1", "Actividad parcial 2"…'
              className="w-full border border-outline-variant rounded px-2 py-1.5 text-sm mb-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCeldaActiva(null)} className="px-3 py-1.5 rounded border border-outline-variant text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEtiqueta}
                disabled={!nombreCampo.trim()}
                className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-60"
              >
                Marcar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarQuitar && (
        <ConfirmModal
          title="¿Quitar la plantilla oficial?"
          message="Ya no vas a poder generar la Planeación en el formato de tu escuela — vuelve al Excel genérico. Puedes volver a subirla cuando quieras."
          confirmLabel="Quitar"
          confirmingLabel="Quitando…"
          busy={guardando}
          onConfirm={quitarPlantillaGuardada}
          onCancel={() => { if (!guardando) setConfirmarQuitar(false) }}
        />
      )}
    </div>
  )
}
