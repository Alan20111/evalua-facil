import { useState, useEffect, useCallback, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { apiUrl } from '../utils/apiBase'
import { kpisResumen } from '../utils/resumenAdmin'

// Cuánto se espera la respuesta de Firebase Authentication (último acceso y fecha
// de registro) antes de dar el dato por no disponible. Es un tope de error, no
// una pausa: si la respuesta llega antes, se usa en cuanto llega.
export const ACCESOS_TIMEOUT_MS = 15000

// Mapa vacío compartido: mantiene la misma identidad entre renders (las tablas
// lo usan como dependencia de sus useMemo).
const SIN_DATOS = Object.freeze({})

const AUTH_INICIAL = Object.freeze({
  // `true` cuando la petición TERMINÓ alguna vez (con éxito, con fallo o por
  // tope). Una vez que es true no vuelve a false: «Actualizar» no vacía nada.
  resuelto: false,
  // 'cargando' (sin respuesta todavía) | 'listo' | 'agotado' | 'error'
  estado: 'cargando',
  // `true` solo si alguna vez llegó un dato confirmado de Auth. Mientras sea
  // false, los indicadores que dependen de él muestran «—», nunca un 0.
  datosDisponibles: false,
  // Cuándo terminó la última respuesta CORRECTA (Date). null mientras no haya una.
  actualizadoEn: null,
  // `true` cuando la última consulta falló o agotó el tiempo DESPUÉS de una
  // correcta: los datos que se muestran son los de `actualizadoEn`, no los de
  // ahora. Vuelve a false cuando una consulta nueva termina bien.
  obsoleto: false,
  accesos: SIN_DATOS,
  creadoEn: SIN_DATOS,
})

export function useAdminStats() {
  const { currentUser } = useAuth()
  const [base, setBase] = useState(null)
  const [authInfo, setAuthInfo] = useState(AUTH_INICIAL)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [
        usersSnap,
        studentsSnap,
        subsSnap,
        paymentsSnap,
        creditPurchasesSnap,
        plansSnap,
        schoolsSnap,
        subjectsSnap,
        bajasSnap,
      ] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'subscriptions')),
        getDocs(collection(db, 'payments')),
        getDocs(collection(db, 'creditPurchases')),
        getDocs(collection(db, 'plans')),
        getDocs(collection(db, 'schools')),
        getDocs(collection(db, 'subjects')),
        getDocs(collection(db, 'bajas')).catch(() => ({ docs: [] })),
      ])

      const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Colecciones HISTÓRICAS del modelo anterior (suscripciones y pagos). Se
      // siguen leyendo solo porque la tabla de Registros y Ventas por zona aún
      // las usan; ya no alimentan ningún indicador del Resumen.
      const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const creditPurchases = creditPurchasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const schools = schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Constancias de cuentas eliminadas: solo nombre, correo y fecha de baja
      // (ver api/account/delete.js). Sirven para que el panel muestre la baja
      // en vez de que el renglón desaparezca sin dejar rastro.
      const bajas = bajasSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const teachers = users.filter((u) => u.role === 'docente')

      const schoolCounts = {}
      teachers.forEach((t) => {
        if (t.escuelaId) schoolCounts[t.escuelaId] = (schoolCounts[t.escuelaId] || 0) + 1
      })
      const schoolsMap = Object.fromEntries(schools.map((s) => [s.id, s]))
      const teachersBySchool = Object.entries(schoolCounts)
        .map(([id, count]) => ({ school: schoolsMap[id]?.shortName || schoolsMap[id]?.claveSEP || id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const subsistemaDist = {}
      teachers.forEach((t) => {
        const sub = schoolsMap[t.escuelaId]?.subsistema || 'Sin datos'
        subsistemaDist[sub] = (subsistemaDist[sub] || 0) + 1
      })

      // `subjects` ya se cargaba para las medias por docente, pero no se
      // exponía; la tabla de Estudiantes lo necesita para resolver la
      // asignatura de cada alumno y, a través de ella, su profesor (students
      // no guarda docenteId propio).
      const subjectsMap = Object.fromEntries(subjects.map((s) => [s.id, s]))
      const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))

      setBase({
        teachers,
        teachersMap,
        bajas,
        students,
        subjects,
        subjectsMap,
        subscriptions,
        payments,
        creditPurchases,
        plans,
        schools,
        schoolsMap,
        teachersBySchool,
        subsistemaDist,
        // Instante de esta carga: los indicadores «del mes» se calculan contra él,
        // así el resultado no cambia entre renders.
        cargadoEn: new Date(),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Firebase Authentication — último acceso y fecha de creación de cada docente.
  // Este hook es el ÚNICO que lo pide (a api/admin/last-access, porque solo el
  // Admin SDK puede leer la metadata de OTRO usuario) y comparte el resultado
  // con el Resumen y con la tabla de Registros: una petición por carga.
  //
  // Se vuelve a pedir cuando cambia `teachers` (cada carga trae un arreglo
  // nuevo), así «Actualizar» refresca también estos datos.
  const teachers = base?.teachers
  useEffect(() => {
    // Sin docentes o sin sesión no hay nada que pedir (el valor correspondiente
    // se deriva abajo, en `authEfectivo`).
    if (!teachers || teachers.length === 0 || !currentUser) return undefined

    let cancelado = false
    // `agotado`: pasó el tope de espera. Las pantallas ya salieron con el dato
    // «no disponible», así que una respuesta tardía se ignora: aplicarla
    // reacomodaría las filas frente al usuario.
    let agotado = false
    const controlador = new AbortController()
    const temporizador = setTimeout(() => {
      agotado = true
      controlador.abort()
      setAuthInfo((a) => ({ ...a, resuelto: true, estado: 'agotado', obsoleto: a.datosDisponibles }))
    }, ACCESOS_TIMEOUT_MS)

    const fallo = () => {
      if (cancelado || agotado) return
      // Se conservan los datos anteriores (si los había): un fallo al refrescar
      // no los borra, pero quedan marcados como desactualizados para que no se
      // presenten como recién confirmados.
      setAuthInfo((a) => ({ ...a, resuelto: true, estado: 'error', obsoleto: a.datosDisponibles }))
    }

    currentUser.getIdToken()
      .then((token) => fetch(apiUrl('/api/admin/last-access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uids: teachers.map((t) => t.id) }),
        signal: controlador.signal,
      }))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelado || agotado) return
        if (!data || (!data.accesos && !data.creadoEn)) { fallo(); return }
        // La hora se toma aquí y no dentro de la función de actualización, que
        // React puede ejecutar más de una vez.
        const respondioEn = new Date()
        setAuthInfo((a) => ({
          resuelto: true,
          estado: 'listo',
          datosDisponibles: true,
          actualizadoEn: respondioEn,
          obsoleto: false,
          accesos: data.accesos || a.accesos,
          creadoEn: data.creadoEn || a.creadoEn,
        }))
      })
      .catch(fallo)
      .finally(() => clearTimeout(temporizador))

    return () => {
      cancelado = true
      clearTimeout(temporizador)
      controlador.abort()
    }
  }, [currentUser, teachers])

  // Los indicadores del Resumen salen de las funciones puras de resumenAdmin.js
  // (ventas SOLO de creditPurchases; estudiantes como personas distintas;
  // registros desde la fecha de creación de Auth). Se recalculan cuando llega
  // la respuesta de Auth, sin volver a leer Firestore.
  // Lo que se comparte: sin docentes no hay nada que esperar (el 0 de registros
  // es un dato confirmado) y sin sesión no se puede preguntar (queda como error).
  const authEfectivo = useMemo(() => {
    if (!base) return authInfo
    if (base.teachers.length === 0) {
      return { ...authInfo, resuelto: true, estado: 'listo', datosDisponibles: true }
    }
    if (!currentUser && !authInfo.resuelto) return { ...authInfo, resuelto: true, estado: 'error' }
    return authInfo
  }, [base, authInfo, currentUser])

  const stats = useMemo(() => {
    if (!base) return null
    const kpis = kpisResumen({
      docentes: base.teachers,
      students: base.students,
      subjectsMap: base.subjectsMap,
      compras: base.creditPurchases,
      creadoEn: authEfectivo.creadoEn,
      authDisponible: authEfectivo.datosDisponibles,
      authEstado: authEfectivo.estado,
      authObsoleto: authEfectivo.obsoleto,
      authActualizadoEn: authEfectivo.actualizadoEn,
      ahora: base.cargadoEn,
      cantidadMeses: 6,
    })
    return { ...base, authInfo: authEfectivo, kpis }
  }, [base, authEfectivo])

  return { stats, loading, refresh: load }
}
