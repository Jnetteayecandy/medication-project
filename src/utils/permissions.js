import { ROLES } from '../context/AuthContext'

/**
 * ============================================================================
 * PERMISSION GUARDS & AUTHORIZATION HELPERS
 * ============================================================================
 * Clean, production-grade authorization logic enforcing:
 * - Role-Based Access Control (RBAC)
 * - Resource Ownership (Attribute-Based Access Control / ABAC)
 * - Principle of Least Privilege
 */

/**
 * Check if the user is authorized to create a new medication label.
 * - ADMIN: Yes
 * - PHARMACIST: Yes (subject to category restrictions upon save)
 * - STAFF: Yes
 * - GUEST: No (Read-Only)
 */
export function canCreateLabel(user) {
  if (!user || user.role === ROLES.GUEST) return false
  return [ROLES.ADMIN, ROLES.PHARMACIST, ROLES.STAFF].includes(user.role)
}

/**
 * Check if the user is authorized to edit a specific medication label.
 *
 * Rules:
 * 1. GUEST: Strictly forbidden (false).
 * 2. ADMIN: Full access (always true).
 * 3. PHARMACIST: Category restricted.
 *    Can only edit if the label's category (`med_group`) is in `user.allowedCategories` or is wildcard '*'.
 * 4. STAFF: Ownership-based.
 *    Can only edit if `label.created_by === user.id` (or matches creator's email/name).
 */
export function canEditLabel(user, label) {
  if (!user || user.role === ROLES.GUEST) return false
  if (user.role === ROLES.ADMIN) return true

  if (!label) return false

  // Pharmacist: Scoped to allowed medicine categories
  if (user.role === ROLES.PHARMACIST) {
    if (user.allowedCategories?.includes('*')) return true
    if (!label.med_group) return false
    return user.allowedCategories?.includes(label.med_group)
  }

  // Staff: Resource Ownership check
  if (user.role === ROLES.STAFF) {
    // Matches by user ID, or fallback to creator email / username
    if (label.created_by && label.created_by === user.id) return true
    if (label.last_updated_by && label.last_updated_by === user.email) return true
    if (label.created_by_name && label.created_by_name === user.name) return true
    return false
  }

  return false
}

/**
 * Check if the user is authorized to delete a specific medication label.
 * Enforces the same ownership and scope rules as `canEditLabel`.
 */
export function canDeleteLabel(user, label) {
  return canEditLabel(user, label)
}

/**
 * Check if the user has write access to a given medicine category.
 * Used to restrict dropdown selection and filters.
 */
export function canAccessMedicineCategory(user, categoryName) {
  if (!user || user.role === ROLES.GUEST) return false
  if (user.role === ROLES.ADMIN || user.role === ROLES.STAFF) return true

  if (user.role === ROLES.PHARMACIST) {
    if (user.allowedCategories?.includes('*')) return true
    return user.allowedCategories?.includes(categoryName)
  }

  return false
}

/**
 * Check if the user can manage system-level PIL data (Topics 1-7, Footers).
 * System topics are global clinical reference standards managed exclusively by Admin.
 */
export function canManageSystemTopics(user) {
  if (!user) return false
  return user.role === ROLES.ADMIN
}

/**
 * Check if the user owns a specific label (created it themselves).
 */
export function isLabelOwner(user, label) {
  if (!user || !label) return false
  return (
    label.created_by === user.id ||
    label.last_updated_by === user.email ||
    label.created_by_name === user.name
  )
}

/**
 * Get human-readable explanation in Thai and English explaining why an action is blocked.
 * Used for tooltips, badges, and modal security alerts.
 */
export function getPermissionDenialReason(user, action = 'edit', label = null) {
  if (!user) return { th: 'กรุณาเข้าสู่ระบบก่อนทำรายการ', en: 'Authentication required' }

  if (user.role === ROLES.GUEST) {
    return {
      th: 'ผู้เยี่ยมชม (Guest): สิทธิ์อ่านอย่างเดียว ไม่สามารถสร้าง แก้ไข หรือลบข้อมูลได้',
      en: 'Guest Role: Strictly Read-Only. Mutation is prohibited.'
    }
  }

  if (user.role === ROLES.PHARMACIST) {
    const groupName = label?.med_group || 'หมวดหมู่นี้'
    return {
      th: `เภสัชกร: ไม่มีสิทธิ์ในหมวดยา "${groupName}" (จัดการได้เฉพาะหมวดที่ได้รับอนุญาต)`,
      en: `Pharmacist Role: Not authorized for category "${groupName}". Allowed categories: ${user.allowedCategories?.join(', ') || 'None'}`
    }
  }

  if (user.role === ROLES.STAFF) {
    const verbTh = action === 'delete' ? 'ลบ' : (action === 'create' ? 'สร้าง' : 'แก้ไข')
    const verbEn = action === 'delete' ? 'delete' : (action === 'create' ? 'create' : 'modify')
    return {
      th: `เจ้าหน้าที่ (Staff): ${verbTh}ได้เฉพาะรายการยาที่ท่านเป็นผู้สร้างเองเท่านั้น (Ownership Violation)`,
      en: `Staff Role: Resource Ownership required. You can only ${verbEn} your own records.`
    }
  }

  return {
    th: 'ท่านไม่มีสิทธิ์ในการดำเนินการนี้',
    en: 'Access denied: Insufficient permissions.'
  }
}
