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

const NOT_INSTALLED_HINT =
  'Run supabase_medication_save_setup.sql in the Supabase SQL Editor to enable saving for all users.'

function isMissingFunction(error) {
  if (!error) return false
  const msg = `${error.code || ''} ${error.message || ''}`
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)
}

function isMissingColumn(error, column) {
  if (!error) return false
  return (error.message || '').includes(column) && /column/i.test(error.message || '')
}

/**
 * Insert (id null) or update (id given) a label. Only the keys present in `data` are changed.
 * Returns the saved row.
 */
export async function saveMedication(user, id, data) {
  const { data: saved, error } = await supabase.rpc('save_medication_template', {
    p_user_id: user?.id && user.id !== 'guest' ? user.id : null,
    p_id: id != null ? String(id) : null,
    p_data: data
  })

  if (!error) return saved
  if (!isMissingFunction(error)) throw new Error(error.message)

  return saveDirect(user, id, data)
}

async function saveDirect(user, id, data) {
  const stamped = {
    ...data,
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

  let result = await run(stamped)
  if (result.error && isMissingColumn(result.error, 'last_updated_by_id')) {
    const withoutId = { ...stamped }
    delete withoutId.last_updated_by_id
    result = await run(withoutId)
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
  const { error } = await supabase.rpc('delete_medication_template', {
    p_user_id: user?.id && user.id !== 'guest' ? user.id : null,
    p_id: String(med.id)
  })

  if (!error) return
  if (!isMissingFunction(error)) throw new Error(error.message)

  const result = await supabase.from('medication_templates').delete().eq('id', med.id).select('id')
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
