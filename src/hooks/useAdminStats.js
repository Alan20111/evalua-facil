import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { calcDaysRemaining, toDate } from '../utils/subscriptionHelpers'

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
      ] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'subscriptions')),
        getDocs(collection(db, 'payments')),
        getDocs(collection(db, 'plans')),
        getDocs(collection(db, 'schools')),
        getDocs(collection(db, 'subjects')),
      ])

      const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const schools = schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const teachers = users.filter((u) => u.role === 'docente')
      const activeStudents = students.filter((s) => s.activado === true)
      const activeSubs = subscriptions.filter((s) => s.status === 'activa')
      const completedPayments = payments.filter((p) => p.status === 'completado')
      const pendingPayments = payments.filter((p) => p.status === 'pendiente')

      const totalRevenue = completedPayments.reduce((sum, p) => sum + (p.monto || 0), 0)
      const monthRevenue = completedPayments
        .filter((p) => isThisMonth(p.createdAt))
        .reduce((sum, p) => sum + (p.monto || 0), 0)

      const expiringSoon = activeSubs.filter(
        (s) => isWithinDays(s.fechaVencimiento, 7) && calcDaysRemaining(s.fechaVencimiento) >= 0
      )

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

      setStats({
        teachers,
        students,
        subscriptions,
        payments,
        plans,
        schools,
        schoolsMap,
        kpis: {
          teacherCount: teachers.length,
          activeStudentCount: activeStudents.length,
          activeSubCount: activeSubs.length,
          trialCount,
          totalRevenue,
          monthRevenue,
          pendingPaymentCount: pendingPayments.length,
          expiringSoonCount: expiringSoon.length,
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
