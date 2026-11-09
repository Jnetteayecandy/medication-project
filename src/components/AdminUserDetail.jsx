import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ROLE_CONFIG } from '../context/AuthContext'
import { ACTIVITY_LABELS } from '../utils/activityLogger'
import { describeChanges, formatThaiDateTime } from '../utils/activityFormat'

const PAGE_SIZE = 20

/**
 * รายละเอียดผู้ใช้หนึ่งคน: ฉลากยาที่สร้าง + timeline ประวัติการทำงาน
 * ใช้ทั้งในหน้า Admin (ดูคนอื่น) และหน้า "ผลงานของฉัน" (isSelf)
 */
export default function AdminUserDetail({ user, topics, isSelf = false, onOpenLabel }) {
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
          ฉลากที่สร้าง
        </button>
        <button role="tab" aria-selected={tab === 'activity'} className={`uap-tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
          ประวัติการทำงาน
        </button>
      </div>

      {tab === 'labels'
        ? <UserLabels userId={user.id} onOpenLabel={onOpenLabel} />
        : <UserActivity userId={user.id} topics={topics} isSelf={isSelf} />}
    </div>
  )
}

function UserLabels({ userId, onOpenLabel }) {
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('medication_templates')
        .select('*')
        .eq('created_by', userId)
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (err) setError(err.message)
      else setLabels(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  if (loading) return <div className="uap-empty">กำลังโหลดฉลากยา...</div>
  if (error) return <div className="uap-error">โหลดฉลากยาไม่สำเร็จ: {error}</div>
  if (labels.length === 0) return <div className="uap-empty">ผู้ใช้นี้ยังไม่ได้สร้างฉลากยา</div>

  return (
    <ul className="uap-label-list">
      {labels.map(med => (
        <li key={med.id}>
          <button className="uap-label-item" onClick={() => onOpenLabel(med)} title="เปิดดูเอกสาร PIL">
            <span className="uap-label-main">
              <span className="uap-label-name">{med.med_name || '(ไม่มีชื่อยา)'}</span>
              <span className="uap-muted">{[med.med_group, med.med_type].filter(Boolean).join(' · ') || '-'}</span>
            </span>
            <span className="uap-label-side">
              <span className="uap-muted">แก้ไขล่าสุด {formatThaiDateTime(med.updated_at)}</span>
              {med.last_updated_by && <span className="uap-muted">โดย {med.last_updated_by}</span>}
            </span>
          </button>
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

      const { data, error: err, count } = await query
      if (cancelled) return
      if (err) {
        setError(err.message)
        setLogs([])
        setTotal(0)
      } else {
        setLogs(data || [])
        setTotal(count || 0)
      }
      setLoading(false)
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
          <option value="ALL">ทุกประเภท</option>
          {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.th}</option>)}
        </select>
        <label className="uap-date-label">
          ตั้งแต่
          <input className="uap-input" type="date" value={dateFrom} onChange={resetPage(setDateFrom)} />
        </label>
        <label className="uap-date-label">
          ถึง
          <input className="uap-input" type="date" value={dateTo} onChange={resetPage(setDateTo)} />
        </label>
      </div>

      {error && (
        <div className="uap-error">
          โหลดประวัติไม่สำเร็จ: {error}
        </div>
      )}

      {loading ? (
        <div className="uap-empty">กำลังโหลดประวัติการทำงาน...</div>
      ) : logs.length === 0 ? (
        <div className="uap-empty">
          ไม่พบประวัติการทำงาน
          {isSelf && (
            <div className="uap-muted uap-hint">
              หมายเหตุ: ประวัติจะแสดงให้เจ้าของดูได้เฉพาะเมื่อล็อกอินผ่าน Supabase Auth (Admin ดูได้เสมอ)
            </div>
          )}
        </div>
      ) : (
        <ol className="uap-timeline">
          {logs.map(log => {
            const meta = ACTIVITY_LABELS[log.action] || { th: log.action, color: '#64748b', bg: '#f1f5f9' }
            const diffs = describeChanges(log.changes, topics)
            const expanded = expandedId === log.id
            return (
              <li key={log.id} className="uap-timeline-item">
                <span className="uap-dot" style={{ background: meta.color }} />
                <div className="uap-timeline-body">
                  <div className="uap-timeline-head">
                    <span className="uap-badge" style={{ background: meta.bg, color: meta.color }}>{meta.th}</span>
                    <span className="uap-timeline-target">{log.target_name || '-'}</span>
                    <span className="uap-muted uap-timeline-time">{formatThaiDateTime(log.created_at)}</span>
                  </div>
                  {diffs.length > 0 && (
                    <button className="uap-link-btn" onClick={() => setExpandedId(expanded ? null : log.id)}>
                      {expanded ? 'ซ่อนรายละเอียด' : `ดูการเปลี่ยนแปลง (${diffs.length})`}
                    </button>
                  )}
                  {expanded && (
                    <div className="uap-diff-list">
                      {diffs.map(d => (
                        <div key={d.key} className="uap-diff">
                          <div className="uap-diff-label">{d.label}</div>
                          <div className="uap-diff-cols">
                            <div className="uap-diff-old"><span>เดิม</span><p>{d.oldText || '—'}</p></div>
                            <div className="uap-diff-new"><span>ใหม่</span><p>{d.newText || '—'}</p></div>
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
          <button className="uap-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>ก่อนหน้า</button>
          <span className="uap-muted">หน้า {page + 1} / {totalPages} ({total} รายการ)</span>
          <button className="uap-btn" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  )
}
