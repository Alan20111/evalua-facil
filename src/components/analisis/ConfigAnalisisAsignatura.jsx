import { useMemo, useState } from 'react'
import {
  FUENTES_ANALISIS, CLAVES_FUENTES, fuentesConDatos, fuentesEfectivas, costoAnalisis,
} from '../../utils/analisisAsignatura'
import { textoParciales, textoFuentes } from '../../utils/analisisAsignaturaInforme'

// Qué explica cada fuente, en una línea — para que el docente sepa qué datos
// se usarán antes de ver el costo.
const DESCRIPCION_FUENTE = {
  entregables: 'Calificaciones y entregas de todos los entregables. No se leen los archivos.',
  observacion: 'Calificaciones de todas las actividades de Observación.',
  evaluaciones: 'Resultados de todos los cuestionarios y exámenes.',
  interactivas: 'Resultados de las actividades interactivas confirmadas.',
  asistencias: 'Asistencias, faltas y justificadas, en general.',
  sinEntrega: 'Actividades vencidas que los estudiantes no realizaron.',
}

const ESTADO_PARCIAL = { atencion: 'atención de inquietudes', cerrado: 'cerrado' }

// Configuración del análisis integral: parciales y fuentes. No ejecuta nada ni
// cobra: solo arma la selección y muestra su costo. `preparacion` viene del
// servidor (prepararAnalisisAsignatura): qué fuentes tienen datos en cada
// parcial y cuánto cuesta cada una — el precio nunca está escrito aquí.
//
// Se monta cuando `preparacion` ya llegó, así el estado inicial es "todo
// seleccionado" sin efectos: quien la use le cambia la `key` para reiniciarla.
export default function ConfigAnalisisAsignatura({ preparacion, onCancelar, onContinuar }) {
  const todosLosParciales = useMemo(() => (preparacion.parciales || []).map((p) => p.numero), [preparacion])
  const [parciales, setParciales] = useState(todosLosParciales)
  const [marcadas, setMarcadas] = useState(CLAVES_FUENTES)

  const disponibilidad = preparacion.disponibilidadPorParcial
  const conDatos = fuentesConDatos(disponibilidad, parciales, marcadas)
  const efectivas = fuentesEfectivas(disponibilidad, parciales, marcadas)
  const costo = costoAnalisis(preparacion.costoPorFuente, efectivas)
  const puedeContinuar = parciales.length > 0 && efectivas.length > 0 && Number.isInteger(costo) && costo > 0
  const ordenados = parciales.slice().sort((a, b) => a - b)

  const alternar = (listado, set, valor) => set(listado.includes(valor) ? listado.filter((x) => x !== valor) : [...listado, valor])
  const todosParcialesMarcados = parciales.length === todosLosParciales.length
  const disponibles = CLAVES_FUENTES.filter((c) => conDatos[c])
  const todasFuentesMarcadas = disponibles.length > 0 && disponibles.every((c) => marcadas.includes(c))

  if (!preparacion.totalEstudiantes) {
    return (
      <>
        <p className="text-sm text-on-surface py-6 text-center">Esta asignatura todavía no tiene estudiantes inscritos: no hay nada que analizar.</p>
        <div className="flex justify-end">
          <button type="button" onClick={onCancelar} className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">Cerrar</button>
        </div>
      </>
    )
  }

  return (
    <>
      <fieldset className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted">1. Parciales</legend>
          <button type="button" disabled={todosParcialesMarcados} onClick={() => setParciales(todosLosParciales)}
            className="text-xs font-semibold text-accent hover:underline disabled:opacity-60 disabled:no-underline">
            Seleccionar todos
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {preparacion.parciales.map((p) => {
            const id = `analisis-parcial-${p.numero}`
            const marcado = parciales.includes(p.numero)
            return (
              <div key={p.numero}
                className={`flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors ${marcado ? 'border-accent bg-[var(--accent-tint)] text-on-surface' : 'border-outline-variant text-muted'}`}>
                <input id={id} type="checkbox" className="accent-[var(--accent)]" checked={marcado}
                  onChange={() => alternar(parciales, setParciales, p.numero)} />
                <label htmlFor={id} className="cursor-pointer">
                  Parcial {p.numero}{ESTADO_PARCIAL[p.estado] ? ` (${ESTADO_PARCIAL[p.estado]})` : ''}
                </label>
              </div>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted">2. Qué se analiza</legend>
          <button type="button" disabled={!disponibles.length || todasFuentesMarcadas}
            onClick={() => setMarcadas(CLAVES_FUENTES)}
            className="text-xs font-semibold text-accent hover:underline disabled:opacity-60 disabled:no-underline">
            Seleccionar todos
          </button>
        </div>
        <ul className="divide-y divide-outline-variant border border-outline-variant rounded">
          {FUENTES_ANALISIS.map((f) => {
            const hay = !!conDatos[f.clave]
            const id = `analisis-fuente-${f.clave}`
            return (
              <li key={f.clave} className={`flex items-start gap-2.5 px-3 py-2.5 ${hay ? '' : 'opacity-60'}`}>
                <input id={id} type="checkbox" className="accent-[var(--accent)] mt-0.5" disabled={!hay}
                  checked={hay && marcadas.includes(f.clave)}
                  aria-describedby={`${id}-desc`}
                  onChange={() => alternar(marcadas, setMarcadas, f.clave)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <label htmlFor={id} className={`text-sm font-medium text-on-surface ${hay ? 'cursor-pointer' : 'cursor-not-allowed'}`}>{f.etiqueta}</label>
                    {!hay && <span className="text-[11px] font-semibold text-muted bg-surface-container px-1.5 py-0.5 rounded-full">Sin datos</span>}
                  </div>
                  <p id={`${id}-desc`} className="text-xs text-muted">{DESCRIPCION_FUENTE[f.clave]}</p>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted mt-1.5">Lo que desmarques queda completamente fuera del análisis. Las calificaciones se toman de las actividades de los tipos marcados.</p>
      </fieldset>

      <div className="rounded border border-outline-variant bg-surface-container px-3 py-2.5 mb-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted mb-1">3. Se analizará</p>
        {puedeContinuar ? (
          <>
            <p className="text-sm text-on-surface">{textoParciales(ordenados)} · {textoFuentes(efectivas)}</p>
            <p className="text-sm font-semibold text-on-surface mt-1.5">Costo del análisis: {costo} {costo === 1 ? 'crédito' : 'créditos'}</p>
          </>
        ) : (
          <p className="text-sm text-muted">
            {!parciales.length ? 'Elige al menos un parcial.'
              : !disponibles.length ? 'No hay datos en los parciales elegidos.'
                : 'Elige al menos una fuente de datos.'}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar}
          className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
          Cancelar
        </button>
        <button type="button" disabled={!puedeContinuar}
          onClick={() => onContinuar({ parciales: ordenados, fuentes: efectivas, costo })}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
          Continuar
        </button>
      </div>
    </>
  )
}
