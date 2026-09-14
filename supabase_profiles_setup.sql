-- ============================================================================
-- SUPABASE AUTHENTICATION & PROFILES SETUP
-- Project: Medication Label System (PIL)
-- ============================================================================

-- 1. Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create the `profiles` table linked to Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'PHARMACIST', 'STAFF', 'GUEST')),
  allowed_categories TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable Row Level Security (RLS) on `profiles`
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;

-- Anyone authenticated can read profile info (to check roles and display names)
CREATE POLICY "Public profiles are viewable by everyone"
ON public.profiles
FOR SELECT
USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id);

-- 4. Trigger to automatically create a profile when a new user registers in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, allowed_categories)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'STAFF'),
    CASE 
      WHEN COALESCE(NEW.raw_user_meta_data->>'role', 'STAFF') = 'ADMIN' THEN ARRAY['*']
      WHEN COALESCE(NEW.raw_user_meta_data->>'role', 'STAFF') = 'PHARMACIST' THEN ARRAY['ยาแก้ปวดและลดไข้', 'ยาลดกรดและระบบทางเดินอาหาร']
      ELSE ARRAY[]::TEXT[]
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 5. SEED 3 TEST USERS DIRECTLY IN SUPABASE
-- Default Password for all accounts: password123
-- ============================================================================

DO $$
DECLARE
  v_admin_id UUID := 'a0000000-0000-0000-0000-000000000001'::UUID;
  v_pharma_id UUID := 'a0000000-0000-0000-0000-000000000002'::UUID;
  v_staff_id UUID := 'a0000000-0000-0000-0000-000000000003'::UUID;
  v_encrypted_pw TEXT;
BEGIN
  -- Generate bcrypt hash for 'password123'
  v_encrypted_pw := crypt('password123', gen_salt('bf'));

  -- A. Admin User: admin@test.com
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@test.com') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'admin@test.com',
      v_encrypted_pw,
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "ดร. สมชาย (Admin)", "role": "ADMIN"}'::jsonb,
      NOW(), NOW(), 'authenticated', 'authenticated'
    );
  ELSE
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@test.com';
    UPDATE auth.users SET encrypted_password = v_encrypted_pw WHERE id = v_admin_id;
  END IF;

  -- Upsert Profile for Admin
  INSERT INTO public.profiles (id, email, name, role, allowed_categories)
  VALUES (v_admin_id, 'admin@test.com', 'ดร. สมชาย (Admin)', 'ADMIN', ARRAY['*'])
  ON CONFLICT (id) DO UPDATE
  SET role = 'ADMIN', allowed_categories = ARRAY['*'], name = 'ดร. สมชาย (Admin)';

  -- B. Pharmacist User: pharma@test.com
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'pharma@test.com') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_pharma_id,
      '00000000-0000-0000-0000-000000000000',
      'pharma@test.com',
      v_encrypted_pw,
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "ภก. วริศรา (Pharmacist)", "role": "PHARMACIST"}'::jsonb,
      NOW(), NOW(), 'authenticated', 'authenticated'
    );
  ELSE
    SELECT id INTO v_pharma_id FROM auth.users WHERE email = 'pharma@test.com';
    UPDATE auth.users SET encrypted_password = v_encrypted_pw WHERE id = v_pharma_id;
  END IF;

  -- Upsert Profile for Pharmacist
  INSERT INTO public.profiles (id, email, name, role, allowed_categories)
  VALUES (
    v_pharma_id,
    'pharma@test.com',
    'ภก. วริศรา (Pharmacist)',
    'PHARMACIST',
    ARRAY['ยาแก้ปวดและลดไข้', 'ยาลดกรดและระบบทางเดินอาหาร']
  )
  ON CONFLICT (id) DO UPDATE
  SET role = 'PHARMACIST',
      allowed_categories = ARRAY['ยาแก้ปวดและลดไข้', 'ยาลดกรดและระบบทางเดินอาหาร'],
      name = 'ภก. วริศรา (Pharmacist)';

  -- C. Staff User: staff@test.com
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'staff@test.com') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      v_staff_id,
      '00000000-0000-0000-0000-000000000000',
      'staff@test.com',
      v_encrypted_pw,
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "สมศักดิ์ (Staff)", "role": "STAFF"}'::jsonb,
      NOW(), NOW(), 'authenticated', 'authenticated'
    );
  ELSE
    SELECT id INTO v_staff_id FROM auth.users WHERE email = 'staff@test.com';
    UPDATE auth.users SET encrypted_password = v_encrypted_pw WHERE id = v_staff_id;
  END IF;

  -- Upsert Profile for Staff
  INSERT INTO public.profiles (id, email, name, role, allowed_categories)
  VALUES (v_staff_id, 'staff@test.com', 'สมศักดิ์ (Staff)', 'STAFF', ARRAY[]::TEXT[])
  ON CONFLICT (id) DO UPDATE
  SET role = 'STAFF', allowed_categories = ARRAY[]::TEXT[], name = 'สมศักดิ์ (Staff)';

END $$;

-- Verify seeded profiles
SELECT id, email, name, role, allowed_categories FROM public.profiles;

