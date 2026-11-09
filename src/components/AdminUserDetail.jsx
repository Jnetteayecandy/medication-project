import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ROLE_CONFIG } from '../context/AuthContext'
import { ACTIVITY_LABELS } from '../utils/activityLogger'
import { describeChanges, formatDateTime, friendlyDbError } from '../utils/activityFormat'
import { withTimeout } from '../utils/medicationStore'

const PAGE_SIZE = 20

/**
 * Details for a single user: labels they created + activity history timeline.
 * Used on the Admin page (viewing others) and on the "My Work" page (isSelf).
 */
export default function AdminUserDetail({ user, topics, isSelf = false, onOpenLabel, onEditLabel, canEdit }) {
  const [tab, setTab] = useState('labels') // 'labels' | 'activity'
  const conf = ROLE_CONFIG[user.role] || ROLE_CONFIG.STAFF

  return (
    <div className="uap-card">
      <div className="uap-profile-head">
        <span className="uap-avatar uap-avatar-lg" style={{ background: conf.badgeBg, color: conf.badgeColor }}>
          {(user.name || user.email || 'U').charAt(0).toUpperCase()}
        </span>
        <div className="uap-profile-text">
          <h2 className="uap-profile-name">{user.name || '-'}</h2>
          <div className="uap-muted">{user.email}</div>
          <div className="uap-profile-meta">
            <span className="uap-badge" style={{ background: conf.badgeBg, color: conf.badgeColor }}>{user.role}</span>
            {user.position && <span className="uap-muted">{user.position}</span>}
            {user.organization && <span className="uap-muted">· {user.organization}</span>}
          </div>
        </div>
      </div>

      <div className="uap-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'labels'} className={`uap-tab ${tab === 'labels' ? 'active' : ''}`} onClick={() => setTab('labels')}>
          Labels Created
        </button>
        <button role="tab" aria-selected={tab === 'activity'} className={`uap-tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
          Activity History
        </button>
      </div>

      {tab === 'labels'
        ? <UserLabels userId={user.id} onOpenLabel={onOpenLabel} onEditLabel={onEditLabel} canEdit={canEdit} />
        : <UserActivity userId={user.id} topics={topics} isSelf={isSelf} />}
    </div>
  )
}

function UserLabels({ userId, onOpenLabel, onEditLabel, canEdit }) {
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await withTimeout(supabase
          .from('medication_templates')
          .select('*')
          .eq('created_by', userId)
          .order('updated_at', { ascending: false }), 20000, 'Loading labels')
        if (cancelled) return
        if (err) setError(friendlyDbError(err.message))
        else setLabels(data || [])
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  if (loading) return <div className="uap-empty">Loading labels...</div>
  if (error) return <div className="uap-error">Failed to load labels: {error}</div>
  if (labels.length === 0) return <div className="uap-empty">This user has not created any labels yet</div>

  return (
    <ul className="uap-label-list">
      {labels.map(med => (
        <li key={med.id} className="uap-label-row">
          <button className="uap-label-item" onClick={() => onOpenLabel(med)} title="View PIL document">
            <span className="uap-label-main">
              <span className="uap-label-name">{med.med_name || '(Untitled medication)'}</span>
              <span className="uap-muted">{[med.med_group, med.med_type].filter(Boolean).join(' · ') || '-'}</span>
            </span>
            <span className="uap-label-side">
              <span className="uap-muted">Last updated {formatDateTime(med.updated_at)}</span>
              {med.last_updated_by && <span className="uap-muted">by {med.last_updated_by}</span>}
            </span>
          </button>
          <div className="uap-label-actions">
            <button className="uap-btn" onClick={() => onOpenLabel(med)} title="View PIL document">View</button>
            {onEditLabel && (canEdit ? canEdit(med) : true) && (
              <button className="uap-btn uap-btn-primary" onClick={() => onEditLabel(med)} title="Edit in the editor">Edit</button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function UserActivity({ userId, topics, isSelf }) {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [actionFilter, setActionFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      let query = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (actionFilter !== 'ALL') query = query.eq('action', actionFilter)
      if (dateFrom) query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString())
      if (dateTo) query = query.lte('created_at', new Date(`${dateTo}T23:59:59.999`).toISOString())

      try {
        const { data, error: err, count } = await withTimeout(query, 20000, 'Loading activity')
        if (cancelled) return
        if (err) {
          setError(friendlyDbError(err.message))
          setLogs([])
          setTotal(0)
        } else {
          setLogs(data || [])
          setTotal(count || 0)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e))
          setLogs([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, page, actionFilter, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const resetPage = (setter) => (e) => { setter(e.target.value); setPage(0) }

  return (
    <div>
      <div className="uap-toolbar">
        <select className="uap-select" value={actionFilter} onChange={resetPage(setActionFilter)}>
          <option value="ALL">All actions</option>
          {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="uap-date-label">
          From
          <input className="uap-input" type="date" value={dateFrom} onChange={resetPage(setDateFrom)} />
        </label>
        <label className="uap-date-label">
          To
          <input className="uap-input" type="date" value={dateTo} onChange={resetPage(setDateTo)} />
        </label>
      </div>

      {error && (
        <div className="uap-error">
          Failed to load activity: {error}
        </div>
      )}

      {loading ? (
        <div className="uap-empty">Loading activity...</div>
      ) : logs.length === 0 ? (
        <div className="uap-empty">
          No activity found
          {isSelf && (
            <div className="uap-muted uap-hint">
              Note: you can only view your own history when signed in via Supabase Auth (Admins can always view it).
            </div>
          )}
        </div>
      ) : (
        <ol className="uap-timeline">
          {logs.map(log => {
            const meta = ACTIVITY_LABELS[log.action] || { label: log.action, color: '#64748b', bg: '#f1f5f9' }
            const diffs = describeChanges(log.changes, topics)
            const expanded = expandedId === log.id
            return (
              <li key={log.id} className="uap-timeline-item">
                <span className="uap-dot" style={{ background: meta.color }} />
                <div className="uap-timeline-body">
                  <div className="uap-timeline-head">
                    <span className="uap-badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                    <span className="uap-timeline-target">{log.target_name || '-'}</span>
                    <span className="uap-muted uap-timeline-time">{formatDateTime(log.created_at)}</span>
                  </div>
                  {diffs.length > 0 && (
                    <button className="uap-link-btn" onClick={() => setExpandedId(expanded ? null : log.id)}>
                      {expanded ? 'Hide details' : `View changes (${diffs.length})`}
                    </button>
                  )}
                  {expanded && (
                    <div className="uap-diff-list">
                      {diffs.map(d => (
                        <div key={d.key} className="uap-diff">
                          <div className="uap-diff-label">{d.label}</div>
                          <div className="uap-diff-cols">
                            <div className="uap-diff-old"><span>Before</span><p>{d.oldText || '—'}</p></div>
                            <div className="uap-diff-new"><span>After</span><p>{d.newText || '—'}</p></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {total > PAGE_SIZE && (
        <div className="uap-pager">
          <button className="uap-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="uap-muted">Page {page + 1} / {totalPages} ({total} items)</span>
          <button className="uap-btn" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
