// Detector de «Sugerencia a Evalúa Fácil» (functions/moderacionSugerencias.js).
// Pruebas puras, sin emulador:   node test/moderacion-sugerencias.test.mjs
//
// La regla de oro: una crítica, aunque sea dura, NO se retiene. Lo que se
// retiene (para revisión humana, nunca para borrar ni sancionar) son
// groserías, insultos, amenazas y acoso. Si agregas una palabra a las listas,
// agrega aquí también un caso que NO debe retenerse con ella.

import { createRequire } from 'node:module'
import assert from 'node:assert'

const require = createRequire(import.meta.url)
const { evaluarTexto, VERSION } = require('../functions/moderacionSugerencias.js')

let pasadas = 0
const fallos = []
function revisar(titulo, textos, esperado, motivo = null) {
  for (const t of textos) {
    const r = evaluarTexto(t)
    const ok = r.estado === esperado && (!motivo || r.motivos.includes(motivo))
    if (ok) pasadas++
    else fallos.push(`${titulo}: «${t}» → ${r.estado} ${JSON.stringify(r.motivos)} (esperado ${esperado}${motivo ? ` con ${motivo}` : ''})`)
  }
  console.log(`  ${fallos.length ? '·' : '✓'} ${titulo} (${textos.length})`)
}

revisar('Sugerencias respetuosas', [
  'Me gustaría poder ver mis calificaciones por parcial en una gráfica.',
  'Sería útil que el calendario mostrara las entregas de la semana.',
  'Gracias por la plataforma, me ayuda mucho.',
  'Propongo que se pueda subir más de un archivo por entrega.',
  'No encuentro dónde cambiar mi contraseña.',
], 'limpia')

revisar('Críticas e inconformidad legítimas', [
  'Esta plataforma es pésima, no carga nada.',
  'La calificación que me pusieron es injusta, no estoy de acuerdo.',
  'Esta app es una basura, no sirve para nada.',
  'Estoy muy molesto, ya van tres veces que se traba.',
  'El maestro no explica bien y me puso cero sin razón.',
  'Odio que se cierre sola la sesión.',
  'Qué mal servicio, es horrible usarla en el teléfono.',
  'No es justo que la IA califique así mi trabajo.',
  'La decisión del docente me parece equivocada y quiero que la revisen.',
  'Es frustrante, perdí toda mi tarea.',
  'Pinche página no carga.',
  'Quedó chingón el nuevo diseño.',
  'Está bien chafa la nueva versión.',
], 'limpia')

revisar('Falsos positivos conocidos (palabras inocentes)', [
  'La computadora del laboratorio no abre la página.',
  'Hay una disputa sobre la calificación.',
  'La bomba de agua del taller viene en la tarea.',
  'El video está retrasado.',
  'Voy a buscar la tarea en la biblioteca.',
  'Me gustaría que hubiera una pera en el menú de ejemplos.',
  'Necesito un mensaje de confirmación al entregar.',
  'Tengo 4 tareas del parcial 1 y 3 exámenes.',
  'Quiero escoger otro color y recoger mis archivos.',
  'Mi mamá no puede ver mis calificaciones.',
  'La materia de Ciencias Naturales y la nacional.',
  'El perro de la portada no se ve.',
  'Ya verás que con esto mejora mucho.',
  'Me va a ir mal en el examen si no carga.',
  'Me mató la tarea de hoy.',
  'Cuidado con el cable de la bomba.',
  'Puedo hacer la tarea a mano?',
  'La asignatura de Estadística y Probabilidad.',
], 'limpia')

revisar('Insultos evidentes', [
  'El profe es un pendejo.',
  'Eres un idiota.',
  'Qué imbécil el que hizo esto.',
  'Maestra estúpida.',
  'Eres un cabrón.',
  'Ese culero no me califica.',
  'Hijo de puta.',
  'Chinga tu madre.',
], 'retenida', 'insulto')

revisar('Groserías', [
  'Esta app es una mierda.',
  'Puta madre, no carga.',
  'Puras mamadas en esta página.',
  'Ya me tiene hasta la verga.',
], 'retenida', 'groseria')

revisar('Variantes de escritura', [
  'P3NDEJO el que hizo esto.',
  'p.e.n.d.e.j.o',
  'p e n d e j o s',
  'pendeeeejo',
  'eres una p*ta',
  'IDIOTA',
  'id10ta',
  'imbecil sin acento',
], 'retenida')

revisar('Amenazas', [
  'Te voy a matar, maestro.',
  'Sé dónde vives.',
  'Voy a llevar una pistola a la escuela.',
  'Lo vamos a golpear a la salida.',
  'Te va a ir muy mal.',
  'Ojalá te mueras.',
  'Voy a poner una bomba.',
], 'retenida', 'amenaza')

revisar('Acoso', [
  'Mándame tu pack.',
  'Estás bien buena, maestra.',
  'Pinche maricón.',
  'Te quiero tocar.',
], 'retenida', 'acoso')

// ── Revisión de riesgos (24-oct-2026): las 36 frases medidas y sus variantes ──
// Cada grupo de amenazas tiene su contraparte figurada o de crítica: las
// pruebas deben DISTINGUIRLAS, no solo detectar.

revisar('Expresiones figuradas (no son amenazas)', [
  'Me voy a matar estudiando para el examen',
  'Me voy a morir de aburrimiento con esta app',
  'Esta tarea me está matando',
  'Me mató la tarea de hoy',
  'Vamos a matar el tiempo mientras carga',
  'Voy a matar el proceso que se trabó',
  'Me muero de risa con el nuevo diseño',
  'Si no lo arreglan me va a dar algo',
  'Ya me quiero morir, otra vez se cayó',
  'Mi mamá me va a matar si repruebo',
  'El maestro me va a matar si no entrego',
  'Ese examen estuvo para matarse',
  'Mataron mi tarea al actualizar',
  'Voy a golpear el teclado de coraje',
  'Ojalá se muera esta app y hagan otra',
  'Te va a ir mal en el examen si no estudias',
  // Variantes y contrapartes de las amenazas nuevas
  'Te voy a buscar la información que pediste',
  'Lo voy a buscar en la biblioteca',
  'Cuídate mucho, gracias por todo',
  'No se van a arrepentir de usar esta función',
  'Voy a quemar el disco con la tarea',
  'La app tarda en disparar las notificaciones',
  'Me hace daño a la vista el color tan brillante',
  'Los espero en la sala de cómputo para la entrega',
  'Vas a ver que con esto mejora',
  'Nos vamos a matar de risa con los memes del grupo',
  'Te voy a pegar el link de la tarea',
  'Les voy a quemar un disco con los videos',
  'Se me va a romper la cara de vergüenza',
  'La tarea me va a partir la madre',
], 'limpia')

revisar('Amenazas directas', [
  'Te voy a matar',
  'Lo voy a matar al profe',
  'Voy a matar al maestro',
  'Le voy a partir la madre',
  'Te voy a romper la cara',
  'Te espero a la salida',
  'Te voy a esperar afuera de la escuela',
  'Vas a ver lo que te pasa',
  'Ya sé dónde vives',
  'Se van a arrepentir',
  'Voy a quemar la escuela',
  'Voy a llevar un arma',
  'Mañana traigo una pistola',
  'Voy a poner una bomba',
  'Les voy a disparar',
  'Te voy a desaparecer',
  'Te vamos a buscar',
  'Cuídate porque te voy a encontrar',
  'Ojalá te mueras',
  'Te voy a hacer daño',
  // Variantes
  'Voy a matarte',
  'Te voy a madrear',
  'Les voy a balacear',
  'Voy a matar a todos',
  'Ojalá se muera el maestro',
  'Te va a ir mal conmigo',
  'Te espero afuera',
  'Vas a ver lo que les pasa',
  'Te vas a arrepentir',
  'Voy a incendiar el plantel',
  'Te vamos a buscar a la salida',
  'Voy a partirle la madre',
  'Voy a romperle los dientes',
  'Te voy a pegar',
  'Te voy a apuñalar',
], 'retenida', 'amenaza')

revisar('Críticas a la plataforma con un insulto dirigido a una cosa', [
  'Esta app es estúpida',
  'Qué plataforma tan idiota, no guarda nada',
  'Es estúpido que no se pueda subir PDF',
  'La página está bien pendeja, no carga',
  'El sistema es bien idiota',
  'Este botón es estúpido',
], 'limpia')

revisar('Insultos dirigidos a personas, aunque hablen de la app', [
  'El que hizo esta app es un idiota',
  'Eres un estúpido',
  'El profe es un estúpido, la app no carga',
  'Los de soporte son unos pendejos',
], 'retenida', 'insulto')

revisar('Groserías contra la plataforma (se retienen por ser groserías)', [
  'El sistema es una mierda',
], 'retenida', 'groseria')

// Forma del resultado.
const r = evaluarTexto('Te voy a matar, idiota')
assert.deepStrictEqual(r, { estado: 'retenida', motivos: ['amenaza', 'insulto'], version: VERSION })
assert.deepStrictEqual(evaluarTexto(''), { estado: 'limpia', motivos: [], version: VERSION })
assert.deepStrictEqual(evaluarTexto(null), { estado: 'limpia', motivos: [], version: VERSION })
pasadas += 3
console.log('  ✓ Forma del resultado: motivos ordenados por gravedad, sin las palabras halladas')

console.log(`\n${'─'.repeat(60)}`)
if (fallos.length) {
  console.log(`MODERACION: ${pasadas} pasaron, ${fallos.length} FALLARON`)
  fallos.forEach((f) => console.log(`  ✗ ${f}`))
  process.exitCode = 1
} else {
  console.log(`ALL ${pasadas} MODERACION CHECKS PASSED`)
}
