// Textos de las recomendaciones antes de publicar un video interactivo (ver RecomendacionesVideo.jsx). Describen el flujo: el
// sistema genera, comprueba y ubica cada pregunta; el docente solo la mueve (arrastrando) o edita su texto, y decide cuáles aprobar.
export const RECOMENDACIONES_VIDEO = [
  {
    titulo: 'Cada pregunta ya tiene su momento.',
    corto: 'Cada pregunta ya tiene su momento',
    texto: 'Aparece justo después de que el video explica lo que pregunta. Para cambiarlo, arrastra su punto en la línea de tiempo.',
  },
  {
    titulo: 'Solo pagas las preguntas que recibes.',
    corto: 'Solo pagas las que recibes',
    texto: 'Cada pregunta y su respuesta se comprueban con el video. Si alguna no se puede comprobar, se cambia por otra; si no se logra, se quita. Puedes recibir menos de las que pediste.',
  },
  {
    titulo: 'Tú decides cuáles usar.',
    corto: 'Tú decides cuáles usar',
    texto: 'Edita el texto o las opciones si lo necesitas y aprueba las preguntas que quieras publicar.',
  },
]

export const REGLA_VIDEO = 'Solo se publican para tus estudiantes las preguntas que apruebes.'
