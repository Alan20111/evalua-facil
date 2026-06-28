import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../firebase'

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

                // Migrate old CCT-based usernames (e.g. "110020-05") to
                // school-name format (e.g. "CBTIS255-05") on first login.
                if (/^\d/.test(profile.username)) {
                  const numPart = profile.username.split('-').pop()
                  const prefix = (schoolData.shortName || schoolData.nombre || '')
                    .toUpperCase().replace(/\s+/g, '')
                  if (prefix) {
                    const newUsername = `${prefix}-${numPart}`
                    await updateDoc(doc(db, 'users', user.uid), { username: newUsername })
                    profile.username = newUsername
                  }
                }
              }
            } catch {
              // best-effort
            }
          }
          setUserProfile(profile)
        } else if (user.email?.endsWith('@evalua.local')) {
          // Student account: no users/{uid} doc. Resolve from `students` using the fake email
          // `username.escuelaId@evalua.local`, SCOPED to that school so identical usernames
          // across schools never collide. Prefer the enrollment that already carries this uid.
          try {
            const emailPart = user.email.split('@')[0]
            const dot = emailPart.indexOf('.')
            const username = (dot >= 0 ? emailPart.slice(0, dot) : emailPart).toUpperCase()
            const escuelaId = dot >= 0 ? emailPart.slice(dot + 1) : null
            const studs = await getDocs(
              query(collection(db, 'students'), where('username', '==', username))
            )
            let docs = studs.docs.map((d) => ({ id: d.id, ...d.data() }))
            if (escuelaId) docs = docs.filter((d) => d.escuelaId === escuelaId)
            const s = docs.find((d) => d.uid === user.uid) || docs[0]
            if (s) {
              setUserProfile({ role: 'alumno', studentId: s.id, ...s })
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
