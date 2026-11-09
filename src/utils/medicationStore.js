import { supabase } from '../supabaseClient'
import { logActivity } from './activityLogger'

/**
 * ============================================================================
 * MEDICATION STORE
 * ============================================================================
 * Saves / deletes medication labels.
 *
 * Preferred path: Supabase functions `save_medication_template` / `delete_medication_template`
 * (see supabase_medication_save_setup.sql). They check permissions against `profiles` on the
 * server, work for both Supabase Auth and the app's custom sign-in, and stamp who did it.
 *
 * Fallback (functions not installed yet): direct table writes. Unlike before, a write that
 * RLS silently blocks (0 rows changed) is reported as an error instead of a fake "saved".
 */

const SAVE_TIMEOUT_MS = 20000

/**
 * Reject if `promise` does not settle within `ms`, so a stuck request shows an error
 * instead of the Save button silently doing nothing.
 */
export function withTimeout(promise, ms = SAVE_TIMEOUT_MS, what = 'The database request') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `${what} did not respond within ${Math.round(ms / 1000)} seconds. Please check your connection and try again (refresh the page if it keeps happening).`
    )), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const NOT_INSTALLED_HINT =
  'Run supabase_medication_save_setup.sql in the Supabase SQL Editor to enable saving for all users.'

function isMissingFunction(error) {
  if (!error) return false
  const msg = `${error.code || ''} ${error.message || ''}`
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)
}

// "Could not find the 'x' column of 'medication_templates' in the schema cache"
function missingColumnName(error) {
  if (!error) return null
  const match = (error.message || '').match(/could not find the '([^']+)' column/i)
  return match ? match[1] : null
}

/**
 * Insert (id null) or update (id given) a label. Only the keys present in `data` are changed.
 * Returns the saved row.
 */
export async function saveMedication(user, id, data) {
  const { data: saved, error } = await withTimeout(supabase.rpc('save_medication_template', {
    p_user_id: user?.id && user.id !== 'guest' ? user.id : null,
    p_id: id != null ? String(id) : null,
    p_data: data
  }), SAVE_TIMEOUT_MS, 'Saving')

  if (!error) return saved
  if (!isMissingFunction(error)) throw new Error(error.message)

  return saveDirect(user, id, data)
}

async function saveDirect(user, id, data) {
  const { approve, ...fields } = data
  const stamped = {
    ...fields,
    ...(approve ? {
      approved_by_id: user?.id || null,
      approved_by_name: user?.name || user?.email || null,
      approved_at: new Date().toISOString()
    } : {}),
    last_updated_by: user?.name || user?.email || 'User',
    last_updated_by_role: user?.role || 'STAFF',
    last_updated_by_id: user?.id || null,
    updated_at: new Date().toISOString()
  }
  if (id == null) {
    stamped.created_by = user?.id || null
    stamped.created_by_name = user?.name || null
    stamped.created_by_role = user?.role || null
  }

  const run = (payload) => (id == null
    ? supabase.from('medication_templates').insert([payload]).select()
    : supabase.from('medication_templates').update(payload).eq('id', id).select())

  // If the database lacks optional tracking columns, drop them and retry
  // (only these; real content columns are never dropped silently)
  const optional = new Set(['last_updated_by', 'last_updated_by_role', 'last_updated_by_id',
    'created_by', 'created_by_name', 'created_by_role', 'qr_code_url', 'updated_at',
    'ai_generated', 'approved_by_id', 'approved_by_name', 'approved_at'])
  const payload = { ...stamped }
  let result = await withTimeout(run(payload), SAVE_TIMEOUT_MS, 'Saving')
  for (let i = 0; i < optional.size && result.error; i++) {
    const col = missingColumnName(result.error)
    if (!col || !optional.has(col) || !(col in payload)) break
    delete payload[col]
    result = await withTimeout(run(payload), SAVE_TIMEOUT_MS, 'Saving')
  }

  if (result.error) throw new Error(`${result.error.message}\n\n${NOT_INSTALLED_HINT}`)
  if (!result.data || result.data.length === 0) {
    throw new Error(`The database did not accept the change (blocked by row-level security).\n\n${NOT_INSTALLED_HINT}`)
  }
  return result.data[0]
}

/**
 * Delete a label. The server function logs the deletion itself; the fallback logs it from the client.
 */
export async function deleteMedication(user, med) {
  const { error } = await withTimeout(supabase.rpc('delete_medication_template', {
    p_user_id: user?.id && user.id !== 'guest' ? user.id : null,
    p_id: String(med.id)
  }), SAVE_TIMEOUT_MS, 'Deleting')

  if (!error) return
  if (!isMissingFunction(error)) throw new Error(error.message)

  const result = await withTimeout(
    supabase.from('medication_templates').delete().eq('id', med.id).select('id'),
    SAVE_TIMEOUT_MS, 'Deleting'
  )
  if (result.error) throw new Error(`${result.error.message}\n\n${NOT_INSTALLED_HINT}`)
  if (!result.data || result.data.length === 0) {
    throw new Error(`The database did not accept the deletion (blocked by row-level security).\n\n${NOT_INSTALLED_HINT}`)
  }

  logActivity(user, {
    action: 'delete',
    targetTable: 'medication_templates',
    targetId: med.id,
    targetName: med.med_name,
    changes: {
      med_name: { old: med.med_name ?? null, new: null },
      med_group: { old: med.med_group ?? null, new: null },
      med_type: { old: med.med_type ?? null, new: null }
    }
  })
}
