/**
 * Display helpers for activity history (activity_logs) on the Admin / My Work pages
 */

const FIELD_LABELS = {
  med_name: 'Medication name',
  med_group: 'Drug group',
  med_type: 'Dosage form',
  contents: 'Content',
  ai_generated: 'AI-generated',
  approved_by_name: 'Approved by'
}

export function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function asText(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Turn `changes` (jsonb: { field: { old, new } }) into a readable list.
 * The `contents` field (array of PIL sections) is split into only the sections that changed.
 */
export function describeChanges(changes, topics = []) {
  if (!changes || typeof changes !== 'object') return []
  const out = []

  for (const [field, diff] of Object.entries(changes)) {
    if (!diff || typeof diff !== 'object' || !('old' in diff || 'new' in diff)) continue
    const oldVal = diff.old
    const newVal = diff.new

    if (field === 'contents' && (Array.isArray(oldVal) || Array.isArray(newVal))) {
      const a = Array.isArray(oldVal) ? oldVal : []
      const b = Array.isArray(newVal) ? newVal : []
      const len = Math.max(a.length, b.length)
      for (let i = 0; i < len; i++) {
        if (asText(a[i]) === asText(b[i])) continue
        out.push({
          key: `contents-${i}`,
          label: topics[i] || (i === 0 ? 'Header / additional text' : `Section ${i}`),
          oldText: asText(a[i]),
          newText: asText(b[i])
        })
      }
      continue
    }

    out.push({
      key: field,
      label: FIELD_LABELS[field] || field,
      oldText: asText(oldVal),
      newText: asText(newVal)
    })
  }
  return out
}

/**
 * Explain database errors caused by setup SQL files that have not been run yet.
 */
export function friendlyDbError(message) {
  const msg = String(message || '')
  if (/does not exist|could not find|schema cache|PGRST20/i.test(msg)) {
    return `${msg} — The database setup is incomplete. Run supabase_activity_log_setup.sql and then supabase_medication_save_setup.sql in the Supabase SQL Editor.`
  }
  return msg
}
