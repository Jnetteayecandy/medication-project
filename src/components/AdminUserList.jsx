import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ROLES, ROLE_CONFIG } from '../context/AuthContext'
import { formatDateTime, friendlyDbError } from '../utils/activityFormat'
import { withTimeout } from '../utils/medicationStore'

/**
 * List of all users (Admin only) with a work summary for each user
 */
export default function AdminUserList({ onSelectUser }) {
  const [users, setUsers] = useState([])
  const [labelStats, setLabelStats] = useState({})
  const [activityStats, setActivityStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summaryWarning, setSummaryWarning] = useState(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setSummaryWarning(null)
      try {
        const [profilesRes, labelsRes, summaryRes] = await withTimeout(Promise.all([
          supabase.from('profiles').select('*').order('created_at', { ascending: false }),
          supabase.from('medication_templates').select('id, created_by, last_updated_by_id, updated_at'),
          supabase.rpc('admin_user_activity_summary')
        ]), 20000, 'Loading users')
        if (cancelled) return
        if (profilesRes.error) throw new Error(friendlyDbError(profilesRes.error.message))

        // Summary from medication_templates (already publicly readable)
        const byUser = {}
        const bump = (uid, field, at) => {
          if (!uid) return
          if (!byUser[uid]) byUser[uid] = { created: 0, lastAt: null }
          if (field) byUser[uid][field] += 1
          if (at && (!byUser[uid].lastAt || at > byUser[uid].lastAt)) byUser[uid].lastAt = at
        }
        for (const row of labelsRes.data || []) {
          bump(row.created_by, 'created', row.updated_at)
          if (row.last_updated_by_id && row.last_updated_by_id !== row.created_by) {
            bump(row.last_updated_by_id, null, row.updated_at)
          }
        }

        // Summary from activity_logs (requires an Admin signed in via Supabase Auth)
        const act = {}
        if (summaryRes.error) {
          setSummaryWarning(
            'Unable to load the activity summary (' + summaryRes.error.message + ') ' +
            'Make sure supabase_activity_log_setup.sql has been run and you are signed in with a Supabase Auth Admin account.'
          )
        } else {
          for (const row of summaryRes.data || []) act[row.user_id] = row
        }

        setUsers(profilesRes.data || [])
        setLabelStats(byUser)
        setActivityStats(act)
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users
      .filter(u => roleFilter === 'ALL' || u.role === roleFilter)
      .filter(u => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      .map(u => {
        const ls = labelStats[u.id] || {}
        const as = activityStats[u.id] || {}
        const lastAt = [ls.lastAt, as.last_activity_at].filter(Boolean).sort().pop() || null
        return {
          ...u,
          createdCount: ls.created || 0,
          updateCount: Number(as.update_count || 0),
          totalActivity: Number(as.total_count || 0),
          lastAt
        }
      })
      .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
  }, [users, labelStats, activityStats, search, roleFilter])

  return (
    <div className="uap-card">
      <div className="uap-toolbar">
        <input
          className="uap-input"
          type="search"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="uap-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="ALL">All roles</option>
          {Object.values(ROLES).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {summaryWarning && <div className="uap-warning">{summaryWarning}</div>}
      {error && <div className="uap-error">Failed to load users: {error}</div>}

      {loading ? (
        <div className="uap-empty">Loading users...</div>
      ) : rows.length === 0 ? (
        <div className="uap-empty">No users match your filters</div>
      ) : (
        <div className="uap-table-wrap">
          <table className="uap-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th className="uap-num">Labels Created</th>
                <th className="uap-num">Edits</th>
                <th className="uap-num">Total Activity</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(u => {
                const conf = ROLE_CONFIG[u.role] || ROLE_CONFIG.STAFF
                return (
                  <tr key={u.id} className="uap-row" onClick={() => onSelectUser(u)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSelectUser(u) }}>
                    <td>
                      <div className="uap-user-cell">
                        <span className="uap-avatar" style={{ background: conf.badgeBg, color: conf.badgeColor }}>
                          {(u.name || u.email || 'U').charAt(0).toUpperCase()}
                        </span>
                        <span className="uap-user-text">
                          <span className="uap-user-name">{u.name || '-'}</span>
                          <span className="uap-user-email">{u.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="uap-badge" style={{ background: conf.badgeBg, color: conf.badgeColor }}>{u.role}</span>
                    </td>
                    <td className="uap-num">{u.createdCount}</td>
                    <td className="uap-num">{u.updateCount}</td>
                    <td className="uap-num">{u.totalActivity}</td>
                    <td className="uap-muted">{u.lastAt ? formatDateTime(u.lastAt) : 'No activity yet'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
