import { supabase } from '../supabaseClient'
import { ROLES } from '../context/AuthContext'

/**
 * ============================================================================
 * ACTIVITY LOGGER
 * ============================================================================
 * บันทึก action ฝั่ง client ลงตาราง `activity_logs` ผ่านฟังก์ชัน `log_activity()` ใน Supabase
 *
 * - การสร้าง / แก้ไขฉลากยา ถูกบันทึกอัตโนมัติโดย trigger ในฐานข้อมูลแล้ว ไม่ต้องเรียกซ้ำ
 * - ใช้ฟังก์ชันนี้กับ: 'delete' | 'export_pdf' | 'generate_qr' | 'login'
 * - การบันทึก log ล้มเหลวจะไม่ทำให้งานหลักล้มเหลว (แค่ console.warn)
 */

export const ACTIVITY_LABELS = {
  create: { th: 'สร้างฉลากยา', color: '#059669', bg: '#ecfdf5' },
  update: { th: 'แก้ไขฉลากยา', color: '#2563eb', bg: '#eff6ff' },
  delete: { th: 'ลบฉลากยา', color: '#dc2626', bg: '#fef2f2' },
  export_pdf: { th: 'ส่งออก PDF', color: '#7c3aed', bg: '#f3e8ff' },
  generate_qr: { th: 'สร้าง QR Code', color: '#d97706', bg: '#fffbeb' },
  login: { th: 'เข้าสู่ระบบ', color: '#64748b', bg: '#f1f5f9' }
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
