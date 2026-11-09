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
-- Run in the Supabase SQL Editor (safe to re-run):
--   1) supabase_activity_log_setup.sql
--   2) supabase_medication_save_setup.sql   <-- this file
-- ============================================================================

-- Make sure every column used by the app exists (the live database may never have run
-- the older setup files). All statements are no-ops when the column is already there.
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS allowed_categories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS public.medication_templates
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by_role TEXT,
  ADD COLUMN IF NOT EXISTS last_updated_by_id TEXT,
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Every Supabase Auth account (e.g. Google sign-in) gets a profile, so the Admin page can
-- list everyone and saves are attributed correctly. Existing profiles are never changed.
DO $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  SELECT u.id, COALESCE(u.email, u.id::TEXT || '@unknown.local'),
         COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
         'STAFF'
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Profile backfill skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (NEW.id, COALESCE(NEW.email, NEW.id::TEXT || '@unknown.local'),
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
          'STAFF')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- never block sign-up because of the profile
END;
$$;

DROP TRIGGER IF EXISTS ensure_profile_on_auth_user_created ON auth.users;
CREATE TRIGGER ensure_profile_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_profile_for_new_user();

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
  SELECT UPPER(TRIM(COALESCE(role, 'STAFF'))), COALESCE(allowed_categories, '{}') INTO v_role, v_cats
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
--    - Any change to the label's content (name, group, form, sections) must carry
--      "approve": true - the signed-in user confirms they reviewed and approve this PIL,
--      and is recorded as the approver. QR-link-only updates don't need it.
--    - "ai_generated": true marks content drafted by the AI generator
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
  v_actor UUID;
  v_name TEXT;
  v_role TEXT;
  v_existing public.medication_templates;
  v_new public.medication_templates;
  v_group TEXT;
  v_saved JSONB;
  v_content_change BOOLEAN := p_data ?| ARRAY['med_name', 'med_group', 'med_type', 'contents'];
  v_approve BOOLEAN := COALESCE((p_data->>'approve')::BOOLEAN, FALSE);
  v_ai BOOLEAN := COALESCE((p_data->>'ai_generated')::BOOLEAN, FALSE);
BEGIN
  SELECT actor_id, actor_name, actor_role INTO v_actor, v_name, v_role
  FROM public.resolve_actor(p_user_id);
  IF v_role NOT IN ('ADMIN', 'PHARMACIST', 'STAFF') THEN
    RAISE EXCEPTION 'Permission denied: the "%" role is read-only', v_role;
  END IF;

  v_new := jsonb_populate_record(NULL::public.medication_templates, p_data);

  IF (v_content_change OR p_id IS NULL OR p_id = '') AND NOT v_approve THEN
    RAISE EXCEPTION 'Approval required: tick "I have reviewed and approve this PIL" before saving';
  END IF;

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
      last_updated_by, last_updated_by_role, last_updated_by_id, updated_at,
      ai_generated, approved_by_id, approved_by_name, approved_at
    ) VALUES (
      v_new.med_name, v_new.med_group, v_new.med_type, v_new.contents, v_new.qr_code_url,
      v_actor::TEXT, v_name, v_role,
      v_name, v_role, v_actor::TEXT, NOW(),
      v_ai, v_actor::TEXT, v_name, NOW()
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
    updated_at = NOW(),
    ai_generated     = CASE WHEN v_ai THEN TRUE ELSE COALESCE(t.ai_generated, FALSE) END,
    approved_by_id   = CASE WHEN v_approve THEN v_actor::TEXT ELSE t.approved_by_id END,
    approved_by_name = CASE WHEN v_approve THEN v_name ELSE t.approved_by_name END,
    approved_at      = CASE WHEN v_approve THEN NOW() ELSE t.approved_at END
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
  v_actor UUID;
  v_name TEXT;
  v_role TEXT;
  v_existing public.medication_templates;
BEGIN
  SELECT actor_id, actor_name, actor_role INTO v_actor, v_name, v_role
  FROM public.resolve_actor(p_user_id);
  IF v_role NOT IN ('ADMIN', 'PHARMACIST', 'STAFF') THEN
    RAISE EXCEPTION 'Permission denied: the "%" role is read-only', v_role;
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
