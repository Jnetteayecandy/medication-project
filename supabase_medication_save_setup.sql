-- ============================================================================
-- SUPABASE MEDICATION SAVE / DELETE FIX
-- Project: Medication Label System (PIL)
--
-- Why this file exists:
--   1. The old UPDATE/DELETE policies check `auth.jwt() ->> 'role' = 'ADMIN'`, but in
--      Supabase that claim is always 'authenticated' / 'anon', so updates were silently
--      blocked (0 rows changed) and "Save Template" appeared to do nothing.
--   2. Users created through the app's own sign-up (public.auth table) have no Supabase
--      session, so RLS treated them as `anon` and blocked their inserts.
--
-- Fix: every save/delete goes through SECURITY DEFINER functions that check permissions
-- against public.profiles on the server (ADMIN / PHARMACIST categories / STAFF ownership)
-- and stamp who did it. Every user's work ends up in the database, and the activity-log
-- trigger records it for the Admin page.
--
-- Run order in the Supabase SQL Editor:
--   1) supabase_profiles_setup.sql
--   2) supabase_rls_policies.sql
--   3) supabase_qr_setup.sql
--   4) supabase_activity_log_setup.sql
--   5) supabase_medication_save_setup.sql   <-- this file (safe to re-run)
-- ============================================================================

ALTER TABLE IF EXISTS public.medication_templates
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by_role TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by_id TEXT,
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT;

-- ----------------------------------------------------------------------------
-- 1. Permission helper: can `p_actor` write a label in `p_group` owned by `p_owner`?
--    p_owner = NULL means "creating a new label".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_medication(p_actor UUID, p_group TEXT, p_owner TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_cats TEXT[];
BEGIN
  SELECT role, COALESCE(allowed_categories, '{}') INTO v_role, v_cats
  FROM public.profiles WHERE id = p_actor;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_role = 'ADMIN' THEN RETURN TRUE; END IF;
  IF v_role = 'PHARMACIST' THEN
    RETURN '*' = ANY (v_cats) OR p_group = ANY (v_cats);
  END IF;
  IF v_role = 'STAFF' THEN
    RETURN p_owner IS NULL OR p_owner = p_actor::TEXT;
  END IF;
  RETURN FALSE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. save_medication_template(p_user_id, p_id, p_data)
--    - p_id NULL  -> insert a new label
--    - p_id given -> update; only keys present in p_data are changed
--    - Signed in via Supabase Auth: auth.uid() is used, p_user_id is ignored
--    - Custom-auth users: p_user_id must exist in profiles
--    Returns the saved row as JSON.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_medication_template(
  p_user_id UUID,
  p_id TEXT,
  p_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_user_id);
  v_name TEXT;
  v_role TEXT;
  v_existing public.medication_templates;
  v_new public.medication_templates;
  v_group TEXT;
  v_saved JSONB;
BEGIN
  SELECT COALESCE(name, email), role INTO v_name, v_role
  FROM public.profiles WHERE id = v_actor;
  IF NOT FOUND OR v_role NOT IN ('ADMIN', 'PHARMACIST', 'STAFF') THEN
    RAISE EXCEPTION 'Permission denied: unknown user or read-only role';
  END IF;

  v_new := jsonb_populate_record(NULL::public.medication_templates, p_data);

  IF p_id IS NULL OR p_id = '' THEN
    IF COALESCE(TRIM(v_new.med_name), '') = '' THEN
      RAISE EXCEPTION 'Medication name is required';
    END IF;
    IF NOT public.can_write_medication(v_actor, v_new.med_group, NULL) THEN
      RAISE EXCEPTION 'Permission denied: you cannot create labels in group "%"', v_new.med_group;
    END IF;

    INSERT INTO public.medication_templates (
      med_name, med_group, med_type, contents, qr_code_url,
      created_by, created_by_name, created_by_role,
      last_updated_by, last_updated_by_role, last_updated_by_id, updated_at
    ) VALUES (
      v_new.med_name, v_new.med_group, v_new.med_type, v_new.contents, v_new.qr_code_url,
      v_actor::TEXT, v_name, v_role,
      v_name, v_role, v_actor::TEXT, NOW()
    )
    RETURNING to_jsonb(medication_templates.*) INTO v_saved;
    RETURN v_saved;
  END IF;

  SELECT * INTO v_existing FROM public.medication_templates WHERE id::TEXT = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication % not found', p_id;
  END IF;

  v_group := CASE WHEN p_data ? 'med_group' THEN v_new.med_group ELSE v_existing.med_group END;
  IF NOT public.can_write_medication(v_actor, v_existing.med_group, v_existing.created_by)
     OR NOT public.can_write_medication(v_actor, v_group, v_existing.created_by) THEN
    RAISE EXCEPTION 'Permission denied: you cannot edit "%"', v_existing.med_name;
  END IF;

  UPDATE public.medication_templates t SET
    med_name    = CASE WHEN p_data ? 'med_name'    THEN v_new.med_name    ELSE t.med_name END,
    med_group   = v_group,
    med_type    = CASE WHEN p_data ? 'med_type'    THEN v_new.med_type    ELSE t.med_type END,
    contents    = CASE WHEN p_data ? 'contents'    THEN v_new.contents    ELSE t.contents END,
    qr_code_url = CASE WHEN p_data ? 'qr_code_url' THEN v_new.qr_code_url ELSE t.qr_code_url END,
    created_by  = COALESCE(t.created_by, v_actor::TEXT),
    created_by_name = COALESCE(t.created_by_name, v_name),
    created_by_role = COALESCE(t.created_by_role, v_role),
    last_updated_by = v_name,
    last_updated_by_role = v_role,
    last_updated_by_id = v_actor::TEXT,
    updated_at = NOW()
  WHERE t.id = v_existing.id
  RETURNING to_jsonb(t.*) INTO v_saved;

  RETURN v_saved;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. delete_medication_template(p_user_id, p_id) - same rules, and writes the
--    'delete' entry to activity_logs itself
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_medication_template(p_user_id UUID, p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), p_user_id);
  v_name TEXT;
  v_role TEXT;
  v_existing public.medication_templates;
BEGIN
  SELECT COALESCE(name, email), role INTO v_name, v_role
  FROM public.profiles WHERE id = v_actor;
  IF NOT FOUND OR v_role NOT IN ('ADMIN', 'PHARMACIST', 'STAFF') THEN
    RAISE EXCEPTION 'Permission denied: unknown user or read-only role';
  END IF;

  SELECT * INTO v_existing FROM public.medication_templates WHERE id::TEXT = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication % not found', p_id;
  END IF;

  IF NOT public.can_write_medication(v_actor, v_existing.med_group, v_existing.created_by) THEN
    RAISE EXCEPTION 'Permission denied: you cannot delete "%"', v_existing.med_name;
  END IF;

  DELETE FROM public.medication_templates WHERE id = v_existing.id;

  IF to_regclass('public.activity_logs') IS NOT NULL THEN
    INSERT INTO public.activity_logs
      (user_id, user_name, user_role, action, target_table, target_id, target_name, changes)
    VALUES
      (v_actor, v_name, v_role, 'delete', 'medication_templates', p_id, v_existing.med_name,
       jsonb_build_object(
         'med_name', jsonb_build_object('old', v_existing.med_name, 'new', NULL),
         'med_group', jsonb_build_object('old', v_existing.med_group, 'new', NULL),
         'med_type', jsonb_build_object('old', v_existing.med_type, 'new', NULL)
       ));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_medication_template(UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_medication_template(UUID, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Replace the broken JWT-claim policies with profile-based ones
--    (applies to direct table access by Supabase Auth users; the functions above
--    are what the app uses)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authorized roles can insert medications" ON public.medication_templates;
DROP POLICY IF EXISTS "Role based update policy" ON public.medication_templates;
DROP POLICY IF EXISTS "Role based delete policy" ON public.medication_templates;

CREATE POLICY "Authorized roles can insert medications"
ON public.medication_templates
FOR INSERT
WITH CHECK (public.can_write_medication(auth.uid(), med_group, NULL));

CREATE POLICY "Role based update policy"
ON public.medication_templates
FOR UPDATE
USING (public.can_write_medication(auth.uid(), med_group, created_by));

CREATE POLICY "Role based delete policy"
ON public.medication_templates
FOR DELETE
USING (public.can_write_medication(auth.uid(), med_group, created_by));
