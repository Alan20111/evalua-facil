// La Ruleta del Destino · el banco de reactivos en la pantalla del docente (fase 2): avance («32 de 50 reactivos.
// Faltan 18.»), aprobación y la lista con la respuesta correcta marcada. Solo muestra y avisa; cada cambio lo pide la
// pantalla al servidor (RuletaPage → /api/subject/ruleta-banco).
import { CheckCircle2, Circle, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, IconButton, Progress } from '../ui'
import { ICONO } from '../../config/iconos'
import { ORIGENES_BANCO, avanceBanco, normalizarTexto } from '../../utils/ruletaDestino'

const LETRAS = ['A', 'B', 'C', 'D']

/** Ids de los reactivos cuyo enunciado se repite en el banco (no debería pasar: el servidor los rechaza). */
export function idsRepetidos(reactivos) {
  const vistos = new Map()
  const repetidos = new Set()
  for (const r of reactivos) {
    const k = normalizarTexto(r.enunciado)
    if (vistos.has(k)) { repetidos.add(r.id); repetidos.add(vistos.get(k)) } else vistos.set(k, r.id)
  }
  return repetidos
}

// `origen` es el que guardó el servidor en ruletaBancos ('manual' o 'ia'): fija el mínimo del avance y del botón de
// aprobar (IA 25 o 50; manual 50 o 100). La aprobación definitiva la decide siempre el servidor.
export default function BancoRuleta({ reactivos, preguntasPorPartida, origen = ORIGENES_BANCO.manual, aprobado, ocupado, onAgregar, onEditar, onBorrar, onAprobar }) {
  const avance = avanceBanco(reactivos.length, preguntasPorPartida, origen)
  const deIA = origen === ORIGENES_BANCO.ia
  const repetidos = idsRepetidos(reactivos)
  const puedeAprobar = avance.completo && repetidos.size === 0 && !aprobado
  const motivoNoAprobar = aprobado ? 'El banco ya está aprobado.'
    : repetidos.size ? 'Hay reactivos repetidos: corrígelos antes de aprobar.'
    : !avance.completo ? avance.mensaje : null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-semibold text-on-surface" aria-live="polite">
            {avance.conteo} <span className={avance.completo ? 'text-emerald-700' : 'text-muted'}>{avance.mensaje}</span>
          </p>
          {aprobado
            ? <Badge tone="success" icon={ShieldCheck}>Banco aprobado</Badge>
            : <Badge tone="warning">Sin aprobar</Badge>}
        </div>
        <Progress value={Math.min(1, reactivos.length / avance.minimo)} label="Avance del banco" />
        <p className="text-xs text-hint">
          {deIA ? 'Banco generado con IA. ' : ''}Mínimo {avance.minimo} y máximo {avance.maximo} reactivos para partidas de {preguntasPorPartida} preguntas. Cualquier cambio quita la aprobación.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button icon={Plus} onClick={onAgregar} disabled={ocupado || avance.lleno}>Agregar reactivo</Button>
        <Button variant="secondary" icon={ShieldCheck} onClick={onAprobar} disabled={ocupado || !puedeAprobar} busy={ocupado === 'aprobar'}>
          Aprobar banco
        </Button>
      </div>
      {motivoNoAprobar && !aprobado && <p className="text-sm text-muted">{motivoNoAprobar}</p>}
      {avance.lleno && <p className="text-sm text-muted">Llegaste al máximo de {avance.maximo} reactivos.</p>}

      {reactivos.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay reactivos. Agrega el primero.</p>
      ) : (
        <ol className="space-y-2">
          {reactivos.map((r, i) => (
            <li key={r.id} className={`rounded-card border p-3 ${repetidos.has(r.id) ? 'border-red-300' : 'border-outline-variant'}`}>
              <div className="flex items-start gap-2">
                <span className="text-sm font-semibold text-accent flex-shrink-0">{i + 1}.</span>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-base text-on-surface break-words">{r.enunciado}</p>
                  {repetidos.has(r.id) && <p role="alert" className="text-sm text-red-600">Esta pregunta está repetida en el banco.</p>}
                  <ul className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                    {r.opciones.map((o, j) => {
                      const correcta = j === r.correcta
                      const Icono = correcta ? CheckCircle2 : Circle
                      return (
                        <li key={LETRAS[j]} className={`flex items-start gap-1.5 min-w-0 ${correcta ? 'text-emerald-700 font-medium' : 'text-muted'}`}>
                          <Icono size={ICONO.sm} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <span className="break-words">{LETRAS[j]}. {o}{correcta && <span className="sr-only"> (respuesta correcta)</span>}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="flex items-center flex-shrink-0">
                  <IconButton icon={Pencil} label={`Editar reactivo ${i + 1}`} disabled={Boolean(ocupado)} onClick={() => onEditar(r)} />
                  <IconButton icon={Trash2} label={`Eliminar reactivo ${i + 1}`} disabled={Boolean(ocupado)} onClick={() => onBorrar(r)} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
