// Dependencias reales (Firebase + créditos de IA) del orquestador de utils/videoGeneracion.js.
// Una sola definición para la pantalla de creación y para el aviso de «generación pendiente»
// del editor, así las dos hablan con el mismo servidor y guardan igual.
import { useMemo } from 'react'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import useCreditosIA from './useCreditosIA'
import { EVALUACION_DEFAULTS } from '../utils/evaluacionDefaults'
import { guardarPropuestasGeneradas } from '../utils/propuestasVideoDb'

export default function useVideoGeneracionDeps() {
  const creditosIA = useCreditosIA()
  return useMemo(() => ({
    ejecutar: (operacion, params, unidades, opciones) => creditosIA.ejecutar(operacion, params, unidades, opciones),
    crearActividad: async (documento) => (await addDoc(collection(db, 'activities'), documento)).id,
    actualizarActividad: (id, parches) => updateDoc(doc(db, 'activities', id), parches),
    guardarPropuestas: guardarPropuestasGeneradas,
    nuevaClave: () => crypto.randomUUID(),
    extraActividad: () => ({ createdAt: serverTimestamp(), evaluacion: EVALUACION_DEFAULTS.cuestionario }),
  }), [creditosIA])
}
