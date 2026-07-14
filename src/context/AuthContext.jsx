import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { usernameCandidates } from '../utils/generate'
import { initPushNotifications } from '../utils/pushNotifications'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user)
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid))
        if (snap.exists()) {
          const profile = snap.data()
          if (profile.escuelaId && profile.role !== 'alumno') {
            try {
              const schoolSnap = await getDoc(doc(db, 'schools', profile.escuelaId))
              if (schoolSnap.exists()) {
                const schoolData = schoolSnap.data()
                profile.schoolName = schoolData.nombre
                profile.claveSEP = schoolData.claveSEP
              }
            } catch {
              // best-effort
            }
          }
          // Some legacy accounts never got an escuelaId at all — not even the
          // "sin-escuela" sentinel — because they predate that convention. School
          // is optional, so self-heal them to the sentinel instead of leaving
          // escuelaId undefined (which Firestore rejects when writing new docs
          // like subjects/students that store it).
          if (profile.role === 'docente' && !profile.escuelaId) {
            profile.escuelaId = 'sin-escuela'
            profile.schoolName = profile.schoolName || 'Sin escuela'
            updateDoc(doc(db, 'users', user.uid), {
              escuelaId: 'sin-escuela',
              schoolName: profile.schoolName,
            }).catch(() => {})
          }

          // Accounts created before the onboarding wizard existed never went through
          // it, but they did go through the old registration flow (which always set
          // an escuelaId, even the "sin-escuela" sentinel). Treat those as complete
          // so they're never sent to /onboarding; only brand-new accounts (created
          // without an escuelaId) start as incomplete.
          if (profile.role === 'docente' && profile.profileComplete === undefined) {
            const complete = Boolean(profile.escuelaId)
            updateDoc(doc(db, 'users', user.uid), { profileComplete: complete }).catch(() => {})
            profile.profileComplete = complete
          }
          // Onboarding used to only capture `nombreMostrar` (a free-text public
          // alias, e.g. "Profa. Laura García"). Teachers who signed up before
          // `nombre`/`apellidoPaterno` existed get a one-time best-effort split
          // (stripping common titles) so the personal greeting can show
          // nombre + apellidos on two lines, same as students. Editable
          // afterwards in /profile if the split guessed wrong.
          if (profile.role === 'docente' && !profile.nombre && profile.nombreMostrar) {
            const cleaned = profile.nombreMostrar.trim().replace(/^(profa?\.?|mtr[oa]\.?|lic\.?|ing\.?|dra?\.?)\s+/i, '')
            const parts = cleaned.split(/\s+/).filter(Boolean)
            const nombre = parts[0] || profile.nombreMostrar.trim()
            const apellidoPaterno = parts.slice(1).join(' ')
            profile.nombre = nombre
            profile.apellidoPaterno = apellidoPaterno
            updateDoc(doc(db, 'users', user.uid), { nombre, apellidoPaterno }).catch(() => {})
          }
          setUserProfile(profile)
        } else if (user.email?.endsWith('@evalua.local')) {
          // Student account: no users/{uid} doc. Prefer the enrollment(s) that already carry
          // this uid (stamped at activation); fall back to parsing the fake email
          // `username.escuelaId@evalua.local`. The username itself can contain a dot
          // (apellido.nombre format), so the school id is everything after the LAST dot,
          // and lookups must try both case variants (legacy codes are UPPERCASE, new
          // usernames lowercase).
          try {
            let docs = []
            const byUid = await getDocs(
              query(collection(db, 'students'), where('uid', '==', user.uid))
            )
            docs = byUid.docs.map((d) => ({ id: d.id, ...d.data() }))
            if (docs.length === 0) {
              const emailPart = user.email.split('@')[0]
              const dot = emailPart.lastIndexOf('.')
              const username = dot >= 0 ? emailPart.slice(0, dot) : emailPart
              const escuelaId = dot >= 0 ? emailPart.slice(dot + 1) : null
              const snaps = await Promise.all(usernameCandidates(username).map((u) =>
                getDocs(query(collection(db, 'students'), where('username', '==', u)))
              ))
              docs = snaps.flatMap((s) => s.docs).map((d) => ({ id: d.id, ...d.data() }))
              if (escuelaId) docs = docs.filter((d) => d.escuelaId === escuelaId)
            }
            const s = docs.find((d) => d.uid === user.uid) || docs[0]
            if (s) {
              setUserProfile({ role: 'alumno', studentId: s.id, ...s })
              // Fase 4 de notificaciones: registra el dispositivo para push
              // (no-op en web, solo hace algo en la app nativa de Android).
              initPushNotifications(user.uid)
            } else {
              setUserProfile(null)
            }
          } catch {
            setUserProfile(null)
          }
        } else {
          setUserProfile(null)
        }
      } else {
        setUserProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, loading, setUserProfile }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
