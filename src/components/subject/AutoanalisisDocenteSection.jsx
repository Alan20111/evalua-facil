// "Autoanálisis Docente (opcional)" — Asistente IA (13-ago-2026, pedido
// explícito de Kike). Va debajo de "Comentarios generales del grupo y su
// entorno": ese es sobre el GRUPO, este es sobre el DOCENTE mismo — sus
// dominios, huecos y estilo de explicar — y solo alimenta la Planeación
// Didáctica Inicial (no los Diagnósticos, que son sobre el grupo).
// Totalmente opcional: si el docente no contesta nada, la Planeación se
// genera igual, sin este insumo.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ChevronDown, ChevronUp } from 'lucide-react'

const VACIO = {
  temasDomina: '',
  temasFortalecer: '',
  temasFacilExplicar: '',
  temasDificilExplicar: '',
  aspectoMejorar: '',
}

const PREGUNTAS = [
  { campo: 'temasDomina', texto: '¿Qué temas de esta asignatura dominas mejor?', placeholder: 'Ej. Álgebra y trigonometría.' },
  { campo: 'temasFortalecer', texto: '¿Qué temas consideras que necesitas fortalecer?', placeholder: 'Ej. Estadística y probabilidad.' },
  { campo: 'temasFacilExplicar', texto: '¿Qué temas se te facilitan más para explicar?', placeholder: '' },
  { campo: 'temasDificilExplicar', texto: '¿Qué temas se te dificultan más para explicar?', placeholder: '' },
  { campo: 'aspectoMejorar', texto: '¿Qué aspecto de tu forma de enseñar te gustaría mejorar?', placeholder: '' },
]

const MAX_LARGO = 500

function limpiar(respuestas) {
  const out = {}
  for (const { campo } of PREGUNTAS) out[campo] = String(respuestas?.[campo] || '').trim()
  return out
}

function sonIguales(a, b) {
  return PREGUNTAS.every(({ campo }) => a[campo] === b[campo])
}

export default function AutoanalisisDocenteSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [respuestas, setRespuestas] = useState(VACIO)
  const [guardado, setGuardado] = useState(VACIO)
  const [loaded, setLoaded] = useState(false)
  const [guardando, setGuardando] = useState(false)
  // Colapsada por omisión (es opcional, no se le pone al frente al docente
  // sin querer) — pero si ya tenía respuestas guardadas de antes, se abre
  // sola la primera vez que cargan, para que no piense que se perdieron.
  const [abierta, setAbierta] = useState(false)
  const [seAbrioSola, setSeAbrioSola] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      const datos = limpiar(snap.exists() ? snap.data().autoanalisisDocente : null)
      setRespuestas(datos)
      setGuardado(datos)
      setLoaded(true)
      if (!seAbrioSola && !sonIguales(datos, VACIO)) {
        setAbierta(true)
        setSeAbrioSola(true)
      }
    }, () => setLoaded(true))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seAbrioSola es un candado de una sola vez, no debe reiniciar la suscripción
  }, [subjectId])

  async function guardar() {
    setGuardando(true)
    try {
      const limpias = limpiar(respuestas)
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        autoanalisisDocente: limpias,
        actualizadoEn: serverTimestamp(),
      }, { merge: true })
      setRespuestas(limpias)
      setGuardado(limpias)
      toast('Autoanálisis guardado')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  if (!loaded) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div>
          <h2 className="font-bold text-on-surface">Autoanálisis Docente (opcional)</h2>
          {!abierta && (
            <p className="text-sm text-muted mt-0.5">
              Contesta lo que quieras — se toma en cuenta al generar la Planeación Didáctica Inicial.
            </p>
          )}
        </div>
        {abierta ? <ChevronUp size={18} className="text-muted flex-shrink-0" /> : <ChevronDown size={18} className="text-muted flex-shrink-0" />}
      </button>

      {abierta && (
        <>
          <p className="text-sm text-muted mt-0.5 mb-2">
            Contesta lo que quieras — nada aquí es obligatorio. Tus respuestas se toman en cuenta al
            generar la Planeación Didáctica Inicial.
          </p>
          <div className="space-y-3">
            {PREGUNTAS.map(({ campo, texto, placeholder }) => (
              <div key={campo}>
                <label htmlFor={`autoanalisis-${campo}`} className="block text-sm text-on-surface mb-1">{texto}</label>
                <textarea
                  id={`autoanalisis-${campo}`}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y"
                  rows={2}
                  placeholder={placeholder}
                  value={respuestas[campo]}
                  onChange={(e) => setRespuestas((prev) => ({ ...prev, [campo]: e.target.value }))}
                  maxLength={MAX_LARGO}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || sonIguales(respuestas, guardado)}
            className="mt-3 px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {guardando && <Spinner size="sm" />}
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      )}
    </div>
  )
}
