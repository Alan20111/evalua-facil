import { useToast } from '../Toast'
import { EsqueletoVideoInteractivo } from '../esqueletos'
import useProgresoVideo from '../../hooks/useProgresoVideo'
import VideoInteractivoPantalla from './VideoInteractivoPantalla'

// Video interactivo · contenedor del ESTUDIANTE.
//
// Lee el avance guardado del intento (submissions/{id}/progresoVideo/{intento}) y se lo pasa, con el
// guardado real, a VideoInteractivoPantalla (el reproductor, que no importa Firebase). La vista previa del
// docente NO pasa por aquí: monta VideoInteractivoPantalla directamente con manejadores que no escriben.
export default function VideoInteractivoRunner(props) {
  const { submission } = props
  const intento = submission.intentoActual || 1
  const toast = useToast()
  const { cargando, inicial, guardar } = useProgresoVideo({
    submissionId: submission.id,
    intento,
    onFalla: () => toast('No pudimos guardar tu avance en el video. Revisa tu conexión.', 'warning'),
  })
  if (cargando) return <EsqueletoVideoInteractivo />
  return <VideoInteractivoPantalla {...props} progresoInicial={inicial} guardarProgreso={guardar} />
}
