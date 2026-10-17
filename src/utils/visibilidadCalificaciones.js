// Visibilidad de calificaciones PARA EL ESTUDIANTE (fila «Visible al alumno» de
// la tabla de calificaciones del docente).
//
// Qué es: una configuración del docente que decide qué notas puede consultar el
// estudiante. NO toca calificaciones, ponderaciones, ceros por falta de entrega,
// promedios ni exportaciones: el docente siempre ve todo.
//
// Dónde vive: `subjects/{id}.calificacionesOcultas`. Solo se guarda lo OCULTO:
//
//   calificacionesOcultas = {
//     actividades: { [actividadId]: true },
//     promedios:   { '1': true, '2': true },   // promedio de cada parcial
//     final:       true,                        // calificación final
//   }
//
// Campo, mapa o llave AUSENTES = visible: es el comportamiento de siempre, así
// que no hace falta migrar nada y un dato faltante nunca esconde una nota. Para
// volver a mostrar se BORRA la llave (deleteField), no se guarda `false`.
//
// Por qué en `subjects` y no en `activities`: el candado de parcial cerrado
// (actividadCerradaIntacta) bloquea escrituras en las actividades, y la
// visibilidad debe poder cambiarse con el parcial cerrado porque no altera
// ninguna calificación.
//
// Módulo PURO (sin Firebase ni React): lo importan la tabla del docente y,
// más adelante, el servidor.

import { ponderacionActivaEnParcial, calificacionMostradaAlumno } from './ponderacion.js'

export const CAMPO_OCULTAS = 'calificacionesOcultas'

const esMapa = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Normaliza lo guardado a { actividades, promedios, final }. Cualquier forma
// rara (null, arreglo, texto) cuenta como «nada oculto».
export function leerOcultas(subject) {
  const crudo = subject?.[CAMPO_OCULTAS]
  const m = esMapa(crudo) ? crudo : {}
  return {
    actividades: esMapa(m.actividades) ? m.actividades : {},
    promedios: esMapa(m.promedios) ? m.promedios : {},
    final: m.final === true,
  }
}

// Solo `true` oculta: `false`, null, 0 o texto no cuentan.
export const actividadOculta = (subject, actividadId) =>
  leerOcultas(subject).actividades[String(actividadId)] === true

export const promedioOculto = (subject, parcial) =>
  leerOcultas(subject).promedios[String(parcial)] === true

// Lo que el docente ve en el ojo de la calificación de un parcial: oculta si el
// ojo de siempre la oculta o, en un parcial CON ponderación, si su control
// `calificacionVisible` todavía no la muestra (ponderacion.js). Los pesos no
// intervienen.
export const calificacionOcultaAlAlumno = (subject, parcial) =>
  promedioOculto(subject, parcial) ||
  (ponderacionActivaEnParcial(subject, parcial) && !calificacionMostradaAlumno(subject, parcial))

export const finalOculto = (subject) => leerOcultas(subject).final

export const TIPOS_VISIBILIDAD = ['actividad', 'promedio', 'final']

// Ruta punteada del campo que se cambia. Una sola llave por escritura: cambiar
// un control nunca toca a los demás, ni siquiera si dos cambios llegan seguidos.
export function rutaVisibilidad(tipo, id) {
  if (tipo === 'actividad') return `${CAMPO_OCULTAS}.actividades.${id}`
  if (tipo === 'promedio') return `${CAMPO_OCULTAS}.promedios.${id}`
  if (tipo === 'final') return `${CAMPO_OCULTAS}.final`
  throw new Error(`Tipo de visibilidad desconocido: ${tipo}`)
}

export function estaOculto(subject, tipo, id) {
  if (tipo === 'actividad') return actividadOculta(subject, id)
  if (tipo === 'promedio') return promedioOculto(subject, id)
  if (tipo === 'final') return finalOculto(subject)
  return false
}

// El mapa resultante de ocultar/mostrar UN control, sin mutar el anterior. Es lo
// que la pantalla pone en su estado local tras guardar (la escritura en
// Firestore usa `rutaVisibilidad` con true / deleteField()).
export function conVisibilidad(subject, tipo, id, oculto) {
  const actual = leerOcultas(subject)
  const siguiente = {
    actividades: { ...actual.actividades },
    promedios: { ...actual.promedios },
    final: tipo === 'final' ? oculto === true : actual.final,
  }
  const destino = tipo === 'actividad' ? siguiente.actividades : tipo === 'promedio' ? siguiente.promedios : null
  if (destino) {
    if (oculto) destino[String(id)] = true
    else delete destino[String(id)]
  }
  if (!siguiente.final) delete siguiente.final
  return siguiente
}

// Aviso al docente: si el promedio de un parcial es VISIBLE y alguna de sus
// actividades está oculta, el estudiante puede deducir la nota oculta restando
// las que sí ve (con promedio simple o ponderado). El control no se corrige
// solo —cada uno es independiente—, solo se avisa.
export function promedioDeduceOcultas(subject, parcial, actividades) {
  if (promedioOculto(subject, parcial)) return false
  return (actividades || []).some((a) => actividadOculta(subject, a.id))
}

// Lo mismo para la calificación final: sale del promedio de los parciales, así
// que si es visible y hay algo oculto por debajo, se puede deducir.
export function finalDeduceOcultas(subject, parcialesActividades) {
  if (finalOculto(subject)) return false
  return (parcialesActividades || []).some(({ p, acts }) =>
    promedioOculto(subject, p) || (acts || []).some((a) => actividadOculta(subject, a.id)))
}

export const AVISO_APP_ANTERIOR =
  'Los estudiantes con una versión anterior de la app podrían seguir viendo las notas ocultas hasta que la actualicen.'

export const AVISO_PROMEDIO_DEDUCE =
  'Este promedio incluye notas que el estudiante no ve; podría deducirlas.'
