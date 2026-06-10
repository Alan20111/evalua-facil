import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
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
          // Enrich teacher profiles with their school's name + clave SEP so the UI
          // shows real data instead of the raw Firestore escuelaId.
          if (profile.escuelaId) {
            try {
              const schoolSnap = await getDoc(doc(db, 'schools', profile.escuelaId))
              if (schoolSnap.exists()) {
                profile.schoolName = schoolSnap.data().nombre
                profile.claveSEP = schoolSnap.data().claveSEP
              }
            } catch {
              // best-effort: school lookup failing shouldn't block login
            }
          }
          setUserProfile(profile)
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
