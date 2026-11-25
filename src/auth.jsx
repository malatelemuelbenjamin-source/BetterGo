import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    roles: [],
    permissions: [],
    municipalityIds: [],
    hasGlobalScope: false,
    isAdmin: false,
    isSuperAdmin: false,
  })

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/auth/me')
      setState({
        loading: false,
        user: data.user,
        profile: data.profile,
        roles: data.roles || [],
        permissions: data.permissions || [],
        municipalityIds: data.municipalityIds || [],
        hasGlobalScope: Boolean(data.hasGlobalScope),
        isAdmin: Boolean(data.isAdmin),
        isSuperAdmin: Boolean(data.isSuperAdmin),
      })
      return data
    } catch {
      setState({ loading: false, user: null, profile: null, roles: [], permissions: [], municipalityIds: [], hasGlobalScope: false, isAdmin: false, isSuperAdmin: false })
      return null
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Apply the saved display preference to the document.
  useEffect(() => {
    const saved = localStorage.getItem('bg-theme') || state.profile?.display_preference || 'system'
    const dark = saved === 'dark' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : ''
    if (state.profile?.reduced_motion) document.documentElement.dataset.motion = 'reduced'
    else delete document.documentElement.dataset.motion
    const scale = state.profile?.text_scale || 'default'
    document.documentElement.dataset.textScale = scale === 'default' ? '' : scale
    document.documentElement.dataset.contrast = state.profile?.high_contrast ? 'high' : ''
    document.documentElement.dataset.simplified = state.profile?.simplified_view ? 'on' : ''
  }, [state.profile?.display_preference, state.profile?.reduced_motion, state.profile?.text_scale, state.profile?.high_contrast, state.profile?.simplified_view])

  const login = useCallback(
    async (email, password, mfaCode) => {
      const data = await api.post('/auth/login', { email, password, ...(mfaCode ? { mfaCode } : {}) })
      await refresh()
      return data
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      setState({ loading: false, user: null, profile: null, roles: [], permissions: [], municipalityIds: [], hasGlobalScope: false, isAdmin: false, isSuperAdmin: false })
    }
  }, [])

  const can = useCallback((permission) => state.permissions.includes(permission), [state.permissions])

  const value = useMemo(
    () => ({ ...state, refresh, login, logout, can, setState }),
    [state, refresh, login, logout, can],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export function RequireAuth({ children }) {
  const { loading, user } = useAuth()
  const location = useLocation()
  if (loading) return <div className="loading-block container"><span className="spin" /> Checking your session…</div>
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return children
}

export function RequireAdmin({ children, permission }) {
  const { loading, user, isAdmin, can } = useAuth()
  const location = useLocation()
  if (loading) return <div className="loading-block container"><span className="spin" /> Checking permissions…</div>
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (!isAdmin) return <Navigate to="/dashboard?denied=admin" replace />
  if (permission && !can(permission)) return <Navigate to="/admin?denied=permission" replace />
  return children
}
