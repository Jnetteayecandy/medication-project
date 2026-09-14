/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

/**
 * ============================================================================
 * SECURITY ROLES & CONFIGURATION
 * ============================================================================
 */
export const ROLES = {
  ADMIN: 'ADMIN',
  PHARMACIST: 'PHARMACIST',
  STAFF: 'STAFF',
  GUEST: 'GUEST'
}

export const ROLE_CONFIG = {
  ADMIN: {
    title: 'Chief Medical Officer / Admin',
    badgeColor: '#7c3aed',
    badgeBg: '#f3e8ff',
    icon: null
  },
  PHARMACIST: {
    title: 'Clinical Pharmacist',
    badgeColor: '#059669',
    badgeBg: '#ecfdf5',
    icon: null
  },
  STAFF: {
    title: 'General Hospital Staff',
    badgeColor: '#2563eb',
    badgeBg: '#eff6ff',
    icon: null
  },
  GUEST: {
    title: 'Guest Visitor (Read-Only)',
    badgeColor: '#64748b',
    badgeBg: '#f1f5f9',
    icon: null
  }
}

const GUEST_USER = {
  id: 'guest',
  email: 'guest@hospital.health',
  name: 'Guest Visitor',
  role: ROLES.GUEST,
  title: ROLE_CONFIG.GUEST.title,
  badgeColor: ROLE_CONFIG.GUEST.badgeColor,
  badgeBg: ROLE_CONFIG.GUEST.badgeBg,
  icon: ROLE_CONFIG.GUEST.icon,
  allowedCategories: [],
  isGuest: true
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      if (localStorage.getItem('med_guest_mode') === 'true') return GUEST_USER
    } catch {
      // ignore
    }
    return null
  })

  const [isGuest, setIsGuest] = useState(() => {
    try {
      return localStorage.getItem('med_guest_mode') === 'true'
    } catch {
      return false
    }
  })

  const [loading, setLoading] = useState(true)

  // Fetch or infer user profile from Supabase profiles table
  const loadUserProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setCurrentUser(null)
      return null
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      let finalRole = ROLES.STAFF
      let allowedCats = []
      let displayName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User'

      if (!error && profile) {
        finalRole = profile.role || ROLES.STAFF
        allowedCats = profile.allowed_categories || (finalRole === ROLES.ADMIN ? ['*'] : [])
        if (profile.name) displayName = profile.name
      } else {
        const emailLower = (authUser.email || '').toLowerCase()
        if (emailLower.includes('admin') || authUser.user_metadata?.role === 'ADMIN') {
          finalRole = ROLES.ADMIN
          allowedCats = ['*']
        } else if (emailLower.includes('pharma') || authUser.user_metadata?.role === 'PHARMACIST') {
          finalRole = ROLES.PHARMACIST
          allowedCats = ['ยาแก้ปวดและลดไข้', 'ยาลดกรดและระบบทางเดินอาหาร']
        } else {
          finalRole = ROLES.STAFF
          allowedCats = []
        }
      }

      const conf = ROLE_CONFIG[finalRole] || ROLE_CONFIG.STAFF
      const resolvedUser = {
        id: authUser.id,
        email: authUser.email,
        name: displayName,
        role: finalRole,
        title: conf.title,
        badgeColor: conf.badgeColor,
        badgeBg: conf.badgeBg,
        icon: conf.icon,
        allowedCategories: allowedCats,
        isGuest: false
      }

      setCurrentUser(resolvedUser)
      return resolvedUser
    } catch (err) {
      console.warn('Error loading profile from Supabase:', err)
      const conf = ROLE_CONFIG.STAFF
      const fallbackUser = {
        id: authUser.id,
        email: authUser.email,
        name: authUser.email?.split('@')[0] || 'Staff',
        role: ROLES.STAFF,
        title: conf.title,
        badgeColor: conf.badgeColor,
        badgeBg: conf.badgeBg,
        icon: conf.icon,
        allowedCategories: [],
        isGuest: false
      }
      setCurrentUser(fallbackUser)
      return fallbackUser
    }
  }, [])

  // Initialize session and auth listeners
  useEffect(() => {
    let isMounted = true

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!isMounted) return

        if (session?.user) {
          setIsGuest(false)
          try {
            localStorage.removeItem('med_guest_mode')
          } catch { /* ignore */ }
          await loadUserProfile(session.user)
        } else {
          if (localStorage.getItem('med_guest_mode') === 'true') {
            setIsGuest(true)
            setCurrentUser(GUEST_USER)
          } else {
            setCurrentUser(null)
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return

      if (session?.user) {
        setIsGuest(false)
        try {
          localStorage.removeItem('med_guest_mode')
        } catch { /* ignore */ }
        await loadUserProfile(session.user)
      } else {
        if (localStorage.getItem('med_guest_mode') === 'true') {
          setIsGuest(true)
          setCurrentUser(GUEST_USER)
        } else {
          setIsGuest(false)
          setCurrentUser(null)
        }
      }
      setLoading(false)
    })

    return () => {
      isMounted = false
      subscription?.unsubscribe()
    }
  }, [loadUserProfile])

  // Sign in via Supabase
  const login = async (email, password) => {
    const emailNorm = (email || '').trim().toLowerCase()

    try {
      localStorage.removeItem('med_guest_mode')
    } catch { /* ignore */ }
    setIsGuest(false)

    const result = await supabase.auth.signInWithPassword({ email: emailNorm, password })
    if (result.error) throw result.error
    if (result.data?.user) {
      await loadUserProfile(result.data.user)
    }
    return result
  }

  // Continue as Guest (Strictly Read-Only)
  const loginAsGuest = () => {
    try {
      localStorage.setItem('med_guest_mode', 'true')
    } catch { /* ignore */ }
    setIsGuest(true)
    setCurrentUser(GUEST_USER)
  }

  // Logout / Clear session
  const logout = async () => {
    try {
      localStorage.removeItem('med_guest_mode')
    } catch { /* ignore */ }
    setIsGuest(false)
    setCurrentUser(null)
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore
    }
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentRole: currentUser?.role || (isGuest ? ROLES.GUEST : null),
        isGuest,
        loading,
        login,
        loginAsGuest,
        logout,
        reloadProfile: () => currentUser?.id && loadUserProfile({ id: currentUser.id, email: currentUser.email })
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
