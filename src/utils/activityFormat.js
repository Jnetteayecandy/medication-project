/**
 * Helpers สำหรับแสดงผลประวัติการทำงาน (activity_logs) ในหน้า Admin / ผลงานของฉัน
 */

const FIELD_LABELS = {
  med_name: 'ชื่อยา',
  med_group: 'กลุ่มยา',
  med_type: 'รูปแบบยา',
  contents: 'เนื้อหา'
}

export function formatThaiDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('th-TH', {
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
 * แปลง `changes` (jsonb: { field: { old, new } }) เป็นรายการที่อ่านง่าย
 * ฟิลด์ `contents` (array ของหัวข้อ PIL) จะแยกเป็นรายหัวข้อที่เปลี่ยนจริง
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
          label: topics[i] || (i === 0 ? 'ส่วนหัว / ข้อความเพิ่มเติม' : `หัวข้อที่ ${i}`),
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
