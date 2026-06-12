import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
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
                profile.schoolName = schoolSnap.data().nombre
                profile.claveSEP = schoolSnap.data().claveSEP
              }
            } catch {
              // best-effort
            }
          }
          setUserProfile(profile)
        } else if (user.email?.endsWith('@evalua.local')) {
          // Legacy student account: no users/{uid} doc yet — look up by username
          try {
            const emailPart = user.email.split('@')[0]
            const username = emailPart.slice(0, emailPart.indexOf('.')).toUpperCase()
            const studs = await getDocs(
              query(collection(db, 'students'), where('username', '==', username))
            )
            if (!studs.empty) {
              const s = studs.docs[0]
              setUserProfile({ role: 'alumno', studentId: s.id, ...s.data() })
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
