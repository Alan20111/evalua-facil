import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { calcDaysRemaining, effectiveVencimiento, toDate } from '../utils/subscriptionHelpers'
import { DIAS_POR_VENCER } from '../utils/situacionSuscripcion'

function isThisMonth(date) {
  const d = toDate(date)
  if (!d) return false
  const now = new Date()
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

function isWithinDays(date, days) {
  const d = toDate(date)
  if (!d) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const limit = new Date(now)
  limit.setDate(limit.getDate() + days)
  return d >= now && d <= limit
}

function isWithinLastDays(date, days) {
  const d = toDate(date)
  if (!d) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return d >= cutoff
}

export function useAdminStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [
        usersSnap,
        studentsSnap,
        subsSnap,
        paymentsSnap,
        plansSnap,
        schoolsSnap,
        subjectsSnap,
        bajasSnap,
      ] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'subscriptions')),
        getDocs(collection(db, 'payments')),
        getDocs(collection(db, 'plans')),
        getDocs(collection(db, 'schools')),
        getDocs(collection(db, 'subjects')),
        getDocs(collection(db, 'bajas')).catch(() => ({ docs: [] })),
      ])

      const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const schools = schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Constancias de cuentas eliminadas: solo nombre, correo y fecha de baja
      // (ver api/account/delete.js). Sirven para que el panel muestre la baja
      // en vez de que el renglón desaparezca sin dejar rastro.
      const bajas = bajasSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const teachers = users.filter((u) => u.role === 'docente')
      const activeStudents = students.filter((s) => s.activado === true)
      // "No activados" incluye a quien nunca entró Y a quien el docente puso a
      // reactivar con contraseña temporal (activado vuelve a false): en ambos
      // casos hoy no puede usar la plataforma, que es lo que mide el indicador.
      const inactiveStudents = students.filter((s) => s.activado !== true)
      const activeSubs = subscriptions.filter((s) => s.status === 'activa')
      const completedPayments = payments.filter((p) => p.status === 'completado')
      const pendingPayments = payments.filter((p) => p.status === 'pendiente')

      const totalRevenue = completedPayments.reduce((sum, p) => sum + (p.monto || 0), 0)
      const monthRevenue = completedPayments
        .filter((p) => isThisMonth(p.createdAt))
        .reduce((sum, p) => sum + (p.monto || 0), 0)

      // Cuenta TODAS las suscripciones vivas, no solo las 'activa': mientras el
      // padrón sea casi todo pruebas, mirar únicamente 'activa' dejaba este
      // indicador clavado en cero justo cuando lo único que vence son pruebas.
      // Y el vencimiento sale de effectiveVencimiento, no del campo guardado:
      // en las pruebas anteriores al 28-jun-2026 ese campo trae la ventana
      // vieja de 45/60 días (ver TRIAL_DURATION_DAYS en subscriptionHelpers),
      // así que leerlo directo daba una fecha que la app no respeta.
      const porVencer = (status) =>
        subscriptions.filter((s) => {
          if (s.status !== status) return false
          const venc = effectiveVencimiento(s)
          // La ventana es la MISMA que enciende la insignia naranja de "por
          // vencer" en la tabla de Suscripciones. Antes eran 7 días aquí y 10
          // allá, así que el resumen contaba menos renglones de los que la
          // tabla marcaba en naranja.
          return isWithinDays(venc, DIAS_POR_VENCER) && calcDaysRemaining(venc) >= 0
        })

      // El resumen las separa: una suscripción de paga por vencer se cobra, una
      // prueba por vencer se convierte. Son dos acciones distintas.
      const activeExpiringSoon = porVencer('activa')
      const trialExpiringSoon = porVencer('trial')
      const expiringSoon = [...activeExpiringSoon, ...trialExpiringSoon]

      const conversionRate =
        teachers.length > 0 ? (activeSubs.length / teachers.length) * 100 : 0

      const schoolCounts = {}
      teachers.forEach((t) => {
        if (t.escuelaId) schoolCounts[t.escuelaId] = (schoolCounts[t.escuelaId] || 0) + 1
      })
      const schoolsMap = Object.fromEntries(schools.map((s) => [s.id, s]))
      const teachersBySchool = Object.entries(schoolCounts)
        .map(([id, count]) => ({ school: schoolsMap[id]?.shortName || schoolsMap[id]?.claveSEP || id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const subjectsByTeacher = {}
      subjects.forEach((s) => {
        subjectsByTeacher[s.docenteId] = (subjectsByTeacher[s.docenteId] || 0) + 1
      })
      const studentsByTeacher = {}
      students.forEach((s) => {
        if (s.docenteId) {
          studentsByTeacher[s.docenteId] = (studentsByTeacher[s.docenteId] || 0) + 1
        }
      })

      const avgSubjects =
        teachers.length > 0
          ? Object.values(subjectsByTeacher).reduce((a, b) => a + b, 0) / teachers.length
          : 0
      const avgStudents =
        teachers.length > 0
          ? Object.values(studentsByTeacher).reduce((a, b) => a + b, 0) / teachers.length
          : 0

      const newTeachersThisMonth = teachers.filter((t) => isThisMonth(t.createdAt)).length
      const expiredCount = subscriptions.filter((s) => s.status === 'vencida').length
      const cancelledCount = subscriptions.filter((s) => s.status === 'cancelada').length
      const trialCount = subscriptions.filter((s) => s.status === 'trial').length
      const churnCount = subscriptions.filter(
        (s) => s.status === 'cancelada' && isWithinLastDays(s.updatedAt, 30)
      ).length

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

      setStats({
        teachers,
        teachersMap,
        bajas,
        students,
        subjects,
        subjectsMap,
        subscriptions,
        payments,
        plans,
        schools,
        schoolsMap,
        kpis: {
          teacherCount: teachers.length,
          activeStudentCount: activeStudents.length,
          inactiveStudentCount: inactiveStudents.length,
          activeSubCount: activeSubs.length,
          trialCount,
          totalRevenue,
          monthRevenue,
          pendingPaymentCount: pendingPayments.length,
          expiringSoonCount: expiringSoon.length,
          activeExpiringSoonCount: activeExpiringSoon.length,
          trialExpiringSoonCount: trialExpiringSoon.length,
          conversionRate,
          expiredCount,
          cancelledCount,
          newTeachersThisMonth,
          avgSubjects,
          avgStudents,
          churnCount,
        },
        teachersBySchool,
        subsistemaDist,
        pendingPayments,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { stats, loading, refresh: load }
}
