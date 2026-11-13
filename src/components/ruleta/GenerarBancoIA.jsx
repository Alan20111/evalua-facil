// La Ruleta del Destino · «Generar con IA» (9-nov-2026, decisión 19): el docente adjunta de 1 a 3 archivos de apoyo
// (PDF, DOC o DOCX, hasta 15 MB) y la IA genera el banco COMPLETO: exactamente 25 reactivos para partidas de 5 o 50
// para partidas de 10. Los reactivos quedan sin aprobar para que el docente los revise; no se publica nada ni se crean
// partidas. Todo lo decide el servidor (functions/ruletaGeneracion.js): aquí solo se suben los archivos y se pide.
// «¿Qué quieres evaluar?» (12-nov-2026, decisión 20): el mismo campo de Reto Exprés y Crear evaluación con IA; nace con
// el tema de la ruleta y el docente lo precisa aquí. Solo viaja en esta generación: el tema guardado no cambia.
import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import { Button, Textarea } from '../ui'
import FuentesIAInput from '../ia/FuentesIAInput'
import { useToast } from '../Toast'
import useCreditosIA from '../../hooks/useCreditosIA'
import { subirFuentes } from '../../utils/fuentesIA'
import { RULETA_ARCHIVOS, RULETA_QUIERE_EVALUAR, reactivosGeneracionIA, validarArchivosRuleta, validarQuiereEvaluar } from '../../utils/ruletaDestino'

// La generación verifica cada reactivo contra los documentos: puede tardar más que otras operaciones.
const ESPERA_MS = 290000

export default function GenerarBancoIA({ actividadId, asignaturaId, preguntasPorPartida, temaRuleta = '', disabled = false, onGenerado }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [quiereEvaluar, setQuiereEvaluar] = useState(() => String(temaRuleta || ''))
  const [archivos, setArchivos] = useState([])
  const [trabajando, setTrabajando] = useState(false)
  const cantidad = reactivosGeneracionIA(preguntasPorPartida)
  // 1 crédito por pregunta de la partida (tarifa `generar_banco_ruleta`); el cobro real lo decide el servidor.
  const costo = creditosIA.estimar('generar_banco_ruleta', preguntasPorPartida) ?? preguntasPorPartida

  function cambiarArchivos(lista) {
    const v = validarArchivosRuleta(lista, { completa: false })
    if (!v.ok) { toast(v.mensaje, 'error'); return }
    setArchivos(lista)
  }

  const textoValido = validarQuiereEvaluar(quiereEvaluar)

  async function generar() {
    if (!textoValido.ok) { toast(textoValido.mensaje, 'error'); return }
    const v = validarArchivosRuleta(archivos)
    if (!v.ok) { toast(v.mensaje, 'error'); return }
    setTrabajando(true)
    try {
      const subidos = await subirFuentes(archivos)
      await creditosIA.ejecutar('generar_banco_ruleta', {
        actividadId, asignaturaId: asignaturaId || null,
        quiereEvaluar: quiereEvaluar.trim(),
        archivos: subidos.map((s) => ({ url: s.url, nombre: s.nombre })),
      }, preguntasPorPartida, { timeoutMs: ESPERA_MS })
      toast(`Banco generado: ${cantidad} reactivos. Revísalos y apruébalo.`)
      setArchivos([])
      onGenerado?.()
    } catch (e) {
      toast(e.message || 'No se pudo generar el banco.', 'error')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="space-y-4">
      <Textarea label="¿Qué quieres evaluar?" rows={3} autoResize maxLength={RULETA_QUIERE_EVALUAR.MAX}
        value={quiereEvaluar} disabled={disabled || trabajando} onChange={(e) => setQuiereEvaluar(e.target.value)}
        hint={textoValido.faltan
          ? `Te faltan ${textoValido.faltan} ${textoValido.faltan === 1 ? 'carácter' : 'caracteres'} (mínimo ${RULETA_QUIERE_EVALUAR.MIN}). Precisa el contenido, la unidad o los temas que deben evaluar los reactivos.`
          : 'Todos los reactivos evaluarán esto, con lo que digan los archivos de apoyo. El tema guardado de la ruleta no cambia.'} />
      <FuentesIAInput files={archivos} onChange={cambiarArchivos} disabled={disabled || trabajando}
        accept={RULETA_ARCHIVOS.ACCEPT} titulo="Archivos de apoyo (de 1 a 3)"
        descripcion="PDF, DOC o DOCX, hasta 15 MB cada uno. La IA genera las preguntas solo con lo que dicen estos documentos." />
      <p className="text-sm text-muted">
        La IA generará exactamente <span className="font-semibold text-on-surface">{cantidad} reactivos</span> de opción
        múltiple (4 opciones y una correcta). Quedarán sin aprobar para que los revises y edites.
      </p>
      <p className="text-sm text-muted">
        Esta acción utilizará <span className="font-semibold text-on-surface">{costo}</span> {costo === 1 ? 'crédito' : 'créditos'} de IA.
        Si los documentos no alcanzan para los {cantidad}, no se cobra nada.
      </p>
      <Button onClick={generar} icon={WandSparkles} iconEffect="varita" iconActivo={trabajando}
        disabled={disabled || trabajando || !textoValido.ok || archivos.length < RULETA_ARCHIVOS.MIN}>
        {trabajando ? 'Generando reactivos…' : `Generar ${cantidad} reactivos con IA`}
      </Button>
    </div>
  )
}
