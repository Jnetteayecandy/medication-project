-- ============================================================================
-- SUPABASE ACTIVITY LOG SETUP
-- Project: Medication Label System (PIL)
-- Purpose: เก็บประวัติการทำงานของผู้ใช้แต่ละคน ให้ Admin ตรวจสอบได้ว่าใครทำอะไรไปบ้าง
--
-- Run in the Supabase SQL Editor (safe to re-run):
--   1) supabase_activity_log_setup.sql      <-- this file
--   2) supabase_medication_save_setup.sql
--
-- หมายเหตุเรื่องการล็อกอิน:
--   ระบบมีการล็อกอิน 2 แบบ คือ Supabase Auth (เช่น admin@test.com) และตาราง public.auth (custom)
--   ผู้ใช้ custom auth ไม่มี JWT ของ Supabase (auth.uid() เป็น NULL) จึงออกแบบดังนี้
--   - การสร้าง/แก้ไขยา: บันทึก log อัตโนมัติด้วย trigger โดยระบุตัวผู้ทำจากคอลัมน์ในแถว
--   - action ฝั่ง client (ลบ, export PDF, QR): บันทึกผ่านฟังก์ชัน log_activity()
--   - การอ่าน log: ต้องเป็น ADMIN ที่ล็อกอินผ่าน Supabase Auth เท่านั้น (ตรวจจาก profiles ฝั่งเซิร์ฟเวอร์)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Required columns (last_updated_by_id links edits to a user id; TEXT to match created_by)
-- ----------------------------------------------------------------------------
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
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- 2. ตาราง activity_logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'export_pdf', 'generate_qr', 'login')),
  target_table TEXT,
  target_id TEXT,
  target_name TEXT,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_user_created_idx
  ON public.activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_target_idx
  ON public.activity_logs (target_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_idx
  ON public.activity_logs (created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Helper functions
-- ----------------------------------------------------------------------------

-- ตรวจว่าผู้ใช้ที่ล็อกอินอยู่ (Supabase Auth) เป็น ADMIN หรือไม่ โดยดูจากตาราง profiles
-- ไม่เชื่อค่า role ที่ส่งมาจากฝั่ง client
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND UPPER(TRIM(role)) = 'ADMIN'
  );
$$;

-- แปลง TEXT เป็น UUID แบบไม่ error (คืน NULL ถ้าแปลงไม่ได้)
CREATE OR REPLACE FUNCTION public.try_uuid(p_text TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_text::UUID;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS: log แก้ไข/ลบไม่ได้, insert ได้เฉพาะผ่าน trigger หรือ log_activity(), อ่านได้เฉพาะ admin หรือเจ้าของ
-- ----------------------------------------------------------------------------
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can read all logs, users read own" ON public.activity_logs;
DROP POLICY IF EXISTS "Users insert own logs" ON public.activity_logs;

CREATE POLICY "Admin can read all logs, users read own"
ON public.activity_logs
FOR SELECT
USING (public.is_admin() OR user_id = auth.uid());

-- ไม่มี policy สำหรับ INSERT / UPDATE / DELETE จึงเขียนตรงผ่าน API ไม่ได้
REVOKE INSERT, UPDATE, DELETE ON public.activity_logs FROM anon, authenticated;
-- อนุญาตให้ query ได้ แต่ RLS ด้านบนจะกรองให้เห็นเฉพาะแถวที่มีสิทธิ์
GRANT SELECT ON public.activity_logs TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Trigger: บันทึก log อัตโนมัติเมื่อสร้าง/แก้ไขฉลากยา
--    - INSERT: ผู้ทำ = created_by
--    - UPDATE: ผู้ทำ = last_updated_by_id (สำรองด้วย auth.uid())
--    - ข้ามการ UPDATE ที่เปลี่ยนแค่ qr_code_url / pdf_url / updated_at (ระบบอัปเดตเอง)
--    - DELETE บันทึกจากฝั่ง client ผ่าน log_activity() เพราะ trigger ไม่รู้ว่าใครลบ
--      เมื่อผู้ใช้เป็น custom auth
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_medication_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_actor_role TEXT;
  v_changes JSONB;
  v_ignored TEXT[] := ARRAY[
    'updated_at', 'qr_code_url', 'pdf_url',
    'last_updated_by', 'last_updated_by_role', 'last_updated_by_id'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor_id := COALESCE(public.try_uuid(NEW.created_by), auth.uid());
    v_changes := jsonb_build_object(
      'med_name', jsonb_build_object('old', NULL, 'new', to_jsonb(NEW.med_name)),
      'med_group', jsonb_build_object('old', NULL, 'new', to_jsonb(NEW.med_group)),
      'med_type', jsonb_build_object('old', NULL, 'new', to_jsonb(NEW.med_type))
    );
  ELSE
    v_actor_id := COALESCE(public.try_uuid(NEW.last_updated_by_id), auth.uid());

    SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    INTO v_changes
    FROM jsonb_each(to_jsonb(NEW)) AS n
    LEFT JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
      AND n.key <> ALL (v_ignored);

    -- ไม่มีการเปลี่ยนเนื้อหาจริง ไม่ต้องบันทึก
    IF v_changes IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(name, email), UPPER(TRIM(COALESCE(role, 'STAFF'))) INTO v_actor_name, v_actor_role
  FROM public.profiles WHERE id = v_actor_id;

  -- ไม่พบใน profiles ให้ใช้ข้อมูลจากแถวแทน และไม่ผูก FK
  IF NOT FOUND THEN
    v_actor_id := NULL;
    IF TG_OP = 'INSERT' THEN
      v_actor_name := NEW.created_by_name;
      v_actor_role := NEW.created_by_role;
    ELSE
      v_actor_name := NEW.last_updated_by;
      v_actor_role := NEW.last_updated_by_role;
    END IF;
  END IF;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action, target_table, target_id, target_name, changes)
  VALUES
    (v_actor_id, v_actor_name, v_actor_role,
     CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END,
     'medication_templates', NEW.id::TEXT, NEW.med_name, v_changes);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medication_templates_activity_log ON public.medication_templates;
CREATE TRIGGER medication_templates_activity_log
  AFTER INSERT OR UPDATE ON public.medication_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_medication_change();

-- ----------------------------------------------------------------------------
-- 6a. resolve_actor(): who is doing this, with which name/role?
--     1) the Supabase Auth user (auth.uid()) if they have a profile
--     2) else the app user id sent by the client (custom sign-in) if it has a profile
--     3) else a signed-in Supabase Auth user without a profile (e.g. Google sign-in when
--        the profile trigger was never installed) gets a STAFF profile created now
--     Roles are compared case-insensitively; a missing role counts as STAFF.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_actor(
  p_user_id UUID,
  OUT actor_id UUID,
  OUT actor_name TEXT,
  OUT actor_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_meta JSONB;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT p.id, COALESCE(p.name, p.email), UPPER(TRIM(COALESCE(p.role, 'STAFF')))
      INTO actor_id, actor_name, actor_role
      FROM public.profiles p WHERE p.id = v_uid;
  END IF;

  IF actor_id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT p.id, COALESCE(p.name, p.email), UPPER(TRIM(COALESCE(p.role, 'STAFF')))
      INTO actor_id, actor_name, actor_role
      FROM public.profiles p WHERE p.id = p_user_id;
  END IF;

  IF actor_id IS NULL AND v_uid IS NOT NULL THEN
    SELECT u.email, u.raw_user_meta_data INTO v_email, v_meta FROM auth.users u WHERE u.id = v_uid;
    actor_id := v_uid;
    actor_name := COALESCE(v_meta->>'full_name', v_meta->>'name', split_part(v_email, '@', 1), 'User');
    actor_role := 'STAFF';
    INSERT INTO public.profiles (id, email, name, role)
    VALUES (v_uid, COALESCE(v_email, v_uid::TEXT || '@unknown.local'), actor_name, 'STAFF')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied: no profile found for this account (user id %). Sign out and sign in again, or ask an admin to add your profile.', COALESCE(p_user_id::TEXT, 'none');
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC: log_activity() สำหรับ action ฝั่ง client (ลบ, export PDF, QR, login)
--    - ถ้าล็อกอินผ่าน Supabase Auth: ใช้ auth.uid() เสมอ (ไม่สนใจ p_user_id)
--    - ถ้าเป็น custom auth: ต้องส่ง p_user_id ที่มีอยู่จริงใน profiles และไม่ใช่ GUEST
--    - ชื่อและ role อ่านจาก profiles ฝั่งเซิร์ฟเวอร์ ไม่เชื่อค่าจาก client
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID,
  p_action TEXT,
  p_target_table TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_target_name TEXT DEFAULT NULL,
  p_changes JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_name TEXT;
  v_role TEXT;
BEGIN
  IF p_action NOT IN ('delete', 'export_pdf', 'generate_qr', 'login') THEN
    RAISE EXCEPTION 'action "%" is not allowed from client', p_action;
  END IF;

  SELECT actor_id, actor_name, actor_role INTO v_actor_id, v_name, v_role
  FROM public.resolve_actor(p_user_id);
  IF v_role = 'GUEST' THEN
    RAISE EXCEPTION 'guest users cannot write activity logs';
  END IF;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action, target_table, target_id, target_name, changes)
  VALUES
    (v_actor_id, v_name, v_role, p_action, p_target_table, p_target_id,
     LEFT(p_target_name, 300), p_changes);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: admin_user_activity_summary() สรุปจำนวนการทำงานของผู้ใช้แต่ละคน (เฉพาะ Admin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_activity_summary()
RETURNS TABLE (
  user_id UUID,
  create_count BIGINT,
  update_count BIGINT,
  delete_count BIGINT,
  export_count BIGINT,
  total_count BIGINT,
  last_activity_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    l.user_id,
    COUNT(*) FILTER (WHERE l.action = 'create'),
    COUNT(*) FILTER (WHERE l.action = 'update'),
    COUNT(*) FILTER (WHERE l.action = 'delete'),
    COUNT(*) FILTER (WHERE l.action IN ('export_pdf', 'generate_qr')),
    COUNT(*),
    MAX(l.created_at)
  FROM public.activity_logs l
  WHERE l.user_id IS NOT NULL
  GROUP BY l.user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_activity_summary() TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. ตรวจสอบผลลัพธ์
-- ----------------------------------------------------------------------------
SELECT action, user_name, target_name, created_at
FROM public.activity_logs
ORDER BY created_at DESC
LIMIT 20;
