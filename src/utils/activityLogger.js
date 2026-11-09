import { supabase } from '../supabaseClient'
import { ROLES } from '../context/AuthContext'

/**
 * ============================================================================
 * ACTIVITY LOGGER
 * ============================================================================
 * Records client-side actions in `activity_logs` via the Supabase `log_activity()` function.
 *
 * - Label create / update is already logged automatically by a database trigger; don't log it again.
 * - Use this for: 'delete' | 'export_pdf' | 'generate_qr' | 'login'
 * - A failed log write never fails the main action (console.warn only).
 */

export const ACTIVITY_LABELS = {
  create: { label: 'Created label', color: '#059669', bg: '#ecfdf5' },
  update: { label: 'Edited label', color: '#2563eb', bg: '#eff6ff' },
  delete: { label: 'Deleted label', color: '#dc2626', bg: '#fef2f2' },
  export_pdf: { label: 'Exported PDF', color: '#7c3aed', bg: '#f3e8ff' },
  generate_qr: { label: 'Generated QR code', color: '#d97706', bg: '#fffbeb' },
  login: { label: 'Signed in', color: '#64748b', bg: '#f1f5f9' },
  ai_generate: { label: 'AI-generated draft', color: '#0891b2', bg: '#ecfeff' }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function logActivity(user, { action, targetTable = null, targetId = null, targetName = null, changes = null }) {
  if (!user || user.isGuest || user.role === ROLES.GUEST) return
  if (!user.id || !UUID_RE.test(String(user.id))) return

  try {
    const { error } = await supabase.rpc('log_activity', {
      p_user_id: user.id,
      p_action: action,
      p_target_table: targetTable,
      p_target_id: targetId != null ? String(targetId) : null,
      p_target_name: targetName,
      p_changes: changes
    })
    if (error) console.warn('Activity log notice:', error.message)
  } catch (err) {
    console.warn('Activity log notice:', err)
  }
}
