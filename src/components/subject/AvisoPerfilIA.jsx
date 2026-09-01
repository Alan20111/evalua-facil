// Aviso de "te falta el Perfil para IA del docente" — 1-sep-2026.
//
// Hasta hoy este candado vivía en la pestaña entera (SubjectPage ocultaba
// "Planeación Didáctica" si el Perfil estaba incompleto), y eso dejaba fuera
// al docente que solo quería SUBIR su propia planeación, que no usa IA para
// nada. Ahora el candado vive donde de verdad corresponde: junto a cada botón
// que sí llama a la IA.
//
// No sustituye a nada: el servidor sigue rechazando esas operaciones con
// PERFIL_IA_INCOMPLETO (ver precheckPlaneacionInicial y precheckDiagnosticoBase
// en functions/ia.js). Esto solo evita que el docente lo descubra a golpes.
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'

export default function AvisoPerfilIA({ que = 'generar con Evalúa Fácil' }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded border border-amber-200 bg-amber-50 text-xs text-amber-800">
      <Sparkles size={14} className="flex-shrink-0 mt-0.5" />
      <p>
        Para {que} necesitas completar tu <strong>Perfil para IA del docente</strong> — se llena una sola vez y
        sirve para todas tus asignaturas.{' '}
        <Link to="/perfil-ia" className="underline font-medium">Completarlo ahora</Link>.
      </p>
    </div>
  )
}
