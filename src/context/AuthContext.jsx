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
      // Clear legacy permanent guest storage if exists
      localStorage.removeItem('med_guest_mode')

      // Check for saved custom auth session
      const savedCustom = sessionStorage.getItem('custom_auth_session')
      if (savedCustom) {
        const parsed = JSON.parse(savedCustom)
        if (parsed && parsed.id) return parsed
      }

      if (sessionStorage.getItem('med_guest_mode') === 'true') return GUEST_USER
    } catch {
      // ignore
    }
    return null
  })

  const [isGuest, setIsGuest] = useState(() => {
    try {
      if (sessionStorage.getItem('custom_auth_session')) return false
      return sessionStorage.getItem('med_guest_mode') === 'true'
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

      const hasCompleted = Boolean(
        profile?.has_completed_profile ||
        (profile?.phone && profile?.organization && profile?.position) ||
        (typeof localStorage !== 'undefined' && localStorage.getItem(`pil_profile_${authUser.id}`) === 'true')
      )
      const hasSeenTour = Boolean(
        profile?.has_seen_tour ||
        (typeof localStorage !== 'undefined' && localStorage.getItem(`pil_tour_${authUser.id}`) === 'true')
      )

      const conf = ROLE_CONFIG[finalRole] || ROLE_CONFIG.STAFF
      const resolvedUser = {
        id: authUser.id,
        username: authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'User',
        email: profile?.email || authUser.email,
        name: displayName,
        phone: profile?.phone || '',
        organization: profile?.organization || '',
        position: profile?.position || '',
        role: finalRole,
        title: conf.title,
        badgeColor: conf.badgeColor,
        badgeBg: conf.badgeBg,
        icon: conf.icon,
        allowedCategories: allowedCats,
        isGuest: false,
        has_completed_profile: hasCompleted,
        has_seen_tour: hasSeenTour,
        created_at: profile?.created_at || authUser.created_at || null
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
        // Check for saved custom auth session first
        const savedCustomSession = sessionStorage.getItem('custom_auth_session')
        if (savedCustomSession) {
          try {
            const parsed = JSON.parse(savedCustomSession)
            if (parsed && parsed.id) {
              if (!isMounted) return
              setIsGuest(false)
              setCurrentUser(parsed)
              setLoading(false)
              return
            }
          } catch { /* ignore */ }
        }

        const { data: { session } } = await supabase.auth.getSession()

        if (!isMounted) return

        if (session?.user) {
          setIsGuest(false)
          try {
            localStorage.removeItem('med_guest_mode')
            sessionStorage.removeItem('med_guest_mode')
          } catch { /* ignore */ }
          await loadUserProfile(session.user)
        } else {
          try {
            localStorage.removeItem('med_guest_mode')
          } catch { /* ignore */ }
          if (sessionStorage.getItem('med_guest_mode') === 'true') {
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
          sessionStorage.removeItem('med_guest_mode')
        } catch { /* ignore */ }
        await loadUserProfile(session.user)
      } else {
        if (sessionStorage.getItem('custom_auth_session')) {
          // Keep active custom auth session
          return
        }
        if (sessionStorage.getItem('med_guest_mode') === 'true') {
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

  // Sign in via Supabase (รองรับทั้งตาราง custom auth และ Supabase GoTrue Auth)
  const login = async (emailOrUsername, password) => {
    const raw = (emailOrUsername || '').trim()

    try {
      localStorage.removeItem('med_guest_mode')
      sessionStorage.removeItem('med_guest_mode')
      sessionStorage.removeItem('custom_auth_session')
    } catch { /* ignore */ }
    setIsGuest(false)

    // 1. ตรวจสอบในตาราง custom auth (public.auth)
    try {
      const { data: customAuthUser, error: customAuthErr } = await supabase
        .from('auth')
        .select('*')
        .ilike('username', raw)
        .eq('password', password)
        .maybeSingle()

      if (!customAuthErr && customAuthUser) {
        // ดึงข้อมูล profile ควบคู่กัน
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', customAuthUser.id)
          .maybeSingle()

        const finalRole = profile?.role || ROLES.STAFF
        const conf = ROLE_CONFIG[finalRole] || ROLE_CONFIG.STAFF
        const hasCompleted = Boolean(
          profile?.has_completed_profile ||
          (profile?.phone && profile?.organization && profile?.position) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem(`pil_profile_${customAuthUser.id}`) === 'true')
        )
        const hasSeenTour = Boolean(
          profile?.has_seen_tour ||
          (typeof localStorage !== 'undefined' && localStorage.getItem(`pil_tour_${customAuthUser.id}`) === 'true')
        )

        const resolvedUser = {
          id: customAuthUser.id,
          username: customAuthUser.username,
          email: profile?.email || `${customAuthUser.username}@pil-system.local`,
          name: profile?.name || customAuthUser.username,
          phone: profile?.phone || '',
          organization: profile?.organization || '',
          position: profile?.position || '',
          role: finalRole,
          title: conf.title,
          badgeColor: conf.badgeColor,
          badgeBg: conf.badgeBg,
          icon: conf.icon,
          allowedCategories: profile?.allowed_categories || [],
          isGuest: false,
          has_completed_profile: hasCompleted,
          has_seen_tour: hasSeenTour,
          created_at: customAuthUser.create_at || profile?.created_at || null
        }

        setCurrentUser(resolvedUser)
        try {
          sessionStorage.setItem('custom_auth_session', JSON.stringify(resolvedUser))
        } catch { /* ignore */ }
        return { data: { user: resolvedUser } }
      }
    } catch (checkErr) {
      console.warn('Custom auth check notice:', checkErr)
    }

    // 2. ถ้าไม่พบใน public.auth ให้ลองล็อกอินผ่าน Supabase GoTrue Auth
    const emailNorm = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}@hospital.health`
    const result = await supabase.auth.signInWithPassword({ email: emailNorm, password })
    if (result.error) throw result.error
    if (result.data?.user) {
      await loadUserProfile(result.data.user)
    }
    return result
  }

  // Sign up new user via Supabase into public.auth and public.profiles
  const signup = async (username, password) => {
    const cleanUsername = (username || '').trim()

    // 1. ตรวจสอบก่อนว่า username นี้มีคนใช้ไปแล้วหรือยังในตาราง auth
    const { data: existingUser, error: checkError } = await supabase
      .from('auth')
      .select('id, username')
      .ilike('username', cleanUsername)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      console.warn('Check existing user warning:', checkError)
    }

    if (existingUser) {
      throw new Error('Username นี้มีผู้ใช้งานแล้ว กรุณาเลือก Username อื่น')
    }

    // 2. ทำการบันทึก (Insert) บัญชีใหม่ลงในตาราง auth
    let newUser = null
    const { data, error: authError } = await supabase
      .from('auth')
      .insert([{
        username: cleanUsername,
        password: password, // บันทึกรหัสผ่าน
        create_at: Date.now()
      }])
      .select()
      .single()

    if (authError) {
      // Fallback กรณีตาราง auth กำหนด create_at เป็น timestamptz/timestamp
      if (authError.message?.toLowerCase().includes('create_at') || authError.code === '22007' || authError.code === '42804') {
        const { data: retryData, error: retryError } = await supabase
          .from('auth')
          .insert([{
            username: cleanUsername,
            password: password,
            create_at: new Date().toISOString()
          }])
          .select()
          .single()

        if (retryError) throw retryError
        newUser = retryData
      } else {
        throw authError
      }
    } else {
      newUser = data
    }

    // 3. เมื่อสร้างในตาราง auth สำเร็จ ให้สร้างข้อมูลลงในตาราง profiles ควบคู่กัน (Role เริ่มต้นเป็น 'STAFF')
    if (newUser) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
          id: newUser.id,
          email: `${cleanUsername}@pil-system.local`,
          role: 'STAFF',
          name: cleanUsername,
          allowed_categories: []
        }])

      if (profileError) {
        console.warn('Profile creation notice:', profileError)
      }
    }

    return newUser
  }

  // Sign in with Google OAuth
  const loginWithGoogle = async () => {
    try {
      setIsGuest(false)
      try {
        localStorage.removeItem('med_guest_mode')
        sessionStorage.removeItem('med_guest_mode')
        sessionStorage.removeItem('custom_auth_session')
      } catch { /* ignore */ }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
        }
      })
      if (error) throw error
      return data
    } catch (err) {
      console.error('Google login error:', err)
      throw err
    }
  }

  // Continue as Guest (Strictly Read-Only, valid for active browser session)
  const loginAsGuest = () => {
    try {
      localStorage.removeItem('med_guest_mode')
      sessionStorage.setItem('med_guest_mode', 'true')
    } catch { /* ignore */ }
    setIsGuest(true)
    setCurrentUser(GUEST_USER)
  }

  // Logout / Clear session
  const logout = async () => {
    try {
      localStorage.removeItem('med_guest_mode')
      sessionStorage.removeItem('med_guest_mode')
      sessionStorage.removeItem('custom_auth_session')
    } catch { /* ignore */ }
    setIsGuest(false)
    setCurrentUser(null)
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore
    }
  }

  // Update current user profile in memory and storage
  const updateCurrentUserProfile = (updatedFields) => {
    setCurrentUser(prev => {
      if (!prev) return prev
      const nextUser = { ...prev, ...updatedFields }
      if (updatedFields.has_completed_profile && prev.id && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`pil_profile_${prev.id}`, 'true')
        } catch { /* ignore */ }
      }
      if (updatedFields.has_seen_tour && prev.id && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`pil_tour_${prev.id}`, 'true')
        } catch { /* ignore */ }
      }
      try {
        if (sessionStorage.getItem('custom_auth_session')) {
          sessionStorage.setItem('custom_auth_session', JSON.stringify(nextUser))
        }
      } catch { /* ignore */ }
      return nextUser
    })
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentRole: currentUser?.role || (isGuest ? ROLES.GUEST : null),
        isGuest,
        loading,
        login,
        signup,
        loginWithGoogle,
        updateCurrentUserProfile,
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
