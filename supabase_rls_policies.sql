-- ============================================================================
-- SUPABASE POSTGRESQL ROW LEVEL SECURITY (RLS) POLICIES
-- Project: Medication Label System (PIL)
-- Security Standard: RBAC (Role-Based Access Control) + Resource Ownership
-- ============================================================================

-- 1. เพิ่มฟิลด์รองรับสิทธิ์การเป็นเจ้าของ (Resource Ownership) ในตาราง medication_templates
ALTER TABLE IF EXISTS medication_templates
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT auth.uid()::text,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role TEXT DEFAULT 'STAFF';

-- 2. เปิดใช้งาน Row Level Security (RLS)
ALTER TABLE medication_templates ENABLE ROW LEVEL SECURITY;

-- ลบนโยบายเดิมออกก่อนสร้างใหม่ (Idempotent cleanup)
DROP POLICY IF EXISTS "Public & All Users can view medications" ON medication_templates;
DROP POLICY IF EXISTS "Admin Full Access Policy" ON medication_templates;
DROP POLICY IF EXISTS "Pharmacist Category Scoped Access" ON medication_templates;
DROP POLICY IF EXISTS "Staff Resource Ownership Access" ON medication_templates;
DROP POLICY IF EXISTS "Guest Read Only Access" ON medication_templates;

-- ----------------------------------------------------------------------------
-- POLICY 1: SELECT (การอ่านข้อมูล)
-- ทุกบทบาท (รวมถึง Guest / Anonymous) สามารถอ่านข้อมูลฉลากยาได้ เพื่อความปลอดภัยของผู้ป่วย
-- ----------------------------------------------------------------------------
CREATE POLICY "Public & All Users can view medications"
ON medication_templates
FOR SELECT
USING (true);

-- ----------------------------------------------------------------------------
-- POLICY 2: INSERT (การสร้างข้อมูลใหม่)
-- อนุญาตเฉพาะ Admin, Pharmacist และ Staff (Guest ห้ามสร้าง)
-- ----------------------------------------------------------------------------
CREATE POLICY "Authorized roles can insert medications"
ON medication_templates
FOR INSERT
WITH CHECK (
  COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') IN ('ADMIN', 'PHARMACIST', 'STAFF')
  OR auth.role() = 'authenticated'
);

-- ----------------------------------------------------------------------------
-- POLICY 3: UPDATE (การแก้ไขข้อมูล)
-- - ADMIN: แก้ไขได้ทุกรายการ
-- - PHARMACIST: แก้ไขได้เฉพาะหมวดยาที่ตนเองได้รับอนุญาต (allowed_categories)
-- - STAFF: แก้ไขได้เฉพาะรายการที่ตนเองเป็นผู้สร้าง (Ownership: created_by = auth.uid())
-- ----------------------------------------------------------------------------
CREATE POLICY "Role based update policy"
ON medication_templates
FOR UPDATE
USING (
  -- 1. Admin มีสิทธิ์เต็ม
  (COALESCE(auth.jwt() ->> 'role', '') = 'ADMIN')
  OR
  -- 2. Pharmacist ได้เฉพาะหมวดที่อยู่ใน allowed_categories
  (
    COALESCE(auth.jwt() ->> 'role', '') = 'PHARMACIST'
    AND (
      med_group = ANY (
        SELECT jsonb_array_elements_text(COALESCE(auth.jwt() -> 'allowed_categories', '[]'::jsonb))
      )
      OR COALESCE(auth.jwt() -> 'allowed_categories', '[]'::jsonb) @> '"*"'::jsonb
    )
  )
  OR
  -- 3. Staff แก้ไขได้เฉพาะรายการที่ตนเองสร้าง (Resource Ownership)
  (
    COALESCE(auth.jwt() ->> 'role', '') = 'STAFF'
    AND created_by = auth.uid()::text
  )
);

-- ----------------------------------------------------------------------------
-- POLICY 4: DELETE (การลบข้อมูล)
-- ใช้เกณฑ์ความปลอดภัยเดียวกันกับ UPDATE (Admin ลบได้ทั้งหมด, Staff ลบได้เฉพาะของตน, Guest ห้ามลบ)
-- ----------------------------------------------------------------------------
CREATE POLICY "Role based delete policy"
ON medication_templates
FOR DELETE
USING (
  (COALESCE(auth.jwt() ->> 'role', '') = 'ADMIN')
  OR
  (
    COALESCE(auth.jwt() ->> 'role', '') = 'PHARMACIST'
    AND (
      med_group = ANY (
        SELECT jsonb_array_elements_text(COALESCE(auth.jwt() -> 'allowed_categories', '[]'::jsonb))
      )
      OR COALESCE(auth.jwt() -> 'allowed_categories', '[]'::jsonb) @> '"*"'::jsonb
    )
  )
  OR
  (
    COALESCE(auth.jwt() ->> 'role', '') = 'STAFF'
    AND created_by = auth.uid()::text
  )
);

-- ----------------------------------------------------------------------------
-- SYSTEM TOPICS & FOOTER SECURITY (topic1 - topic7)
-- ตารางมาตรฐานทางการแพทย์กลาง อนุญาตให้เฉพาะ Admin แก้ไขได้เท่านั้น
-- ----------------------------------------------------------------------------
-- ตัวอย่างสำหรับ topic1 ถึง topic7:
-- ALTER TABLE topic1 ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read topic1" ON topic1 FOR SELECT USING (true);
-- CREATE POLICY "Admin mutate topic1" ON topic1 FOR ALL USING (COALESCE(auth.jwt() ->> 'role', '') = 'ADMIN');

