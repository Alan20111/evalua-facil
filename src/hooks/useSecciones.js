import { useState } from 'react'
import { doc } from 'firebase/firestore'
import { updateDoc, writeBatch } from '../utils/firestoreGuard'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { nuevaSeccionId, seccionesDe, datosDeSeccion } from '../utils/secciones'

// Alta, edición, borrado y reordenamiento de las SECCIONES de una evaluación,
// compartido por los dos editores de reactivos (EvaluacionEditor de pantalla
// completa y la pestaña Preguntas de EvaluacionManager). La presentación vive
// en components/SeccionesEditor.jsx; aquí solo la lógica y las escrituras.
//
// Se escribe con ruta punteada (`evaluacion.secciones`) a propósito: así una
// sección nueva no puede pisar el resto de la configuración si el docente tenía
// el formulario de Configuración abierto con valores viejos en pantalla.
//
// @param activityId        id de la actividad (null mientras no se ha guardado)
// @param evaluacion        objeto `activity.evaluacion` actual
// @param preguntas         reactivos ya cargados (para renombrar/desligar)
// @param setPreguntas      para reflejar los cambios sin recargar
// @param onCambio          avisa al editor con el arreglo nuevo de secciones,
//                          para que refresque su copia local de `evaluacion`
export function useSecciones({ activityId, evaluacion, preguntas, setPreguntas, onCambio }) {
  const toast = useToast()
  const secciones = seccionesDe(evaluacion)

  // null = nada abierto · 'nueva' = formulario de alta · {…} = editando esa
  const [editando, setEditando] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [porBorrar, setPorBorrar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  async function escribir(siguientes) {
    await updateDoc(doc(db, 'activities', activityId), { 'evaluacion.secciones': siguientes })
    onCambio?.(siguientes)
  }

  async function guardar({ nombre, descripcion }) {
    if (!activityId) { toast('Guarda la información de arriba primero', 'error'); return }
    setGuardando(true)
    try {
      if (editando === 'nueva') {
        const seccion = { id: nuevaSeccionId(), nombre, descripcion }
        await escribir([...secciones, seccion])
        toast('Sección creada')
      } else {
        const siguientes = secciones.map((s) => (s.id === editando.id ? { ...s, nombre, descripcion } : s))
        await escribir(siguientes)
        // El nombre vive también en cada reactivo (ver utils/secciones.js): al
        // renombrar hay que actualizarlo ahí, o las estadísticas y las
        // exportaciones seguirían mostrando el nombre viejo.
        const suyos = (preguntas || []).filter((p) => p.seccionId === editando.id)
        if (suyos.length && nombre !== editando.nombre) {
          await renombrarEnPreguntas(suyos, nombre)
        }
        toast('Sección actualizada')
      }
      setEditando(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function renombrarEnPreguntas(suyos, nombre) {
    // Tandas de 450: el tope de un lote de Firestore es 500 (mismo margen que
    // el resto del proyecto). Un instrumento no llega ahí, pero el patrón se
    // respeta.
    for (let i = 0; i < suyos.length; i += 450) {
      const batch = writeBatch(db)
      suyos.slice(i, i + 450).forEach((p) => {
        batch.update(doc(db, 'activities', activityId, 'preguntas', p.id), { seccionNombre: nombre })
      })
      await batch.commit()
    }
    const ids = new Set(suyos.map((p) => p.id))
    setPreguntas?.((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, seccionNombre: nombre } : p)))
  }

  async function confirmarBorrado() {
    if (!porBorrar) return
    setBorrando(true)
    try {
      await escribir(secciones.filter((s) => s.id !== porBorrar.id))
      // Los reactivos NO se borran: se quedan fuera de toda sección. Borrar el
      // contenedor no debe borrar el trabajo que hay dentro.
      const suyos = (preguntas || []).filter((p) => p.seccionId === porBorrar.id)
      if (suyos.length) {
        for (let i = 0; i < suyos.length; i += 450) {
          const batch = writeBatch(db)
          suyos.slice(i, i + 450).forEach((p) => {
            batch.update(doc(db, 'activities', activityId, 'preguntas', p.id), { seccionId: null, seccionNombre: null })
          })
          await batch.commit()
        }
        const ids = new Set(suyos.map((p) => p.id))
        setPreguntas?.((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, seccionId: null, seccionNombre: null } : p)))
      }
      setPorBorrar(null)
      toast(suyos.length ? 'Sección eliminada — sus reactivos quedaron fuera de toda sección' : 'Sección eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setBorrando(false)
    }
  }

  async function mover(seccionId, direccion) {
    const i = secciones.findIndex((s) => s.id === seccionId)
    const j = direccion === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= secciones.length) return
    const siguientes = [...secciones]
    ;[siguientes[i], siguientes[j]] = [siguientes[j], siguientes[i]]
    try {
      await escribir(siguientes)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // Mueve UN reactivo a otra sección (o fuera de todas) desde su formulario.
  // Devuelve los campos que hay que guardar junto con el resto del reactivo,
  // para no hacer una escritura aparte.
  function camposDeSeccion(seccionId) {
    return datosDeSeccion(secciones.find((s) => s.id === seccionId))
  }

  return {
    secciones,
    editando, setEditando,
    guardando, guardar,
    porBorrar, setPorBorrar, borrando, confirmarBorrado,
    mover,
    camposDeSeccion,
  }
}
