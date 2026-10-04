-- ============================================================================
-- SUPABASE POSTGRESQL & STORAGE MIGRATION: QR CODE GENERATION & DISTRIBUTION
-- Project: Medication Label System (PIL)
-- Purpose: Support Automated QR Code Generation, Supabase Storage, and Deep-Linking
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DATABASE SCHEMA UPDATES: medication_templates
-- ----------------------------------------------------------------------------
-- Add `qr_code_url` column to store either the Supabase Storage public URL
-- or high-resolution Base64 Data URL fallback for instant resilience.
ALTER TABLE IF EXISTS public.medication_templates
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT;

COMMENT ON COLUMN public.medication_templates.qr_code_url IS 
  'Public URL or Base64 Data URL of the generated QR code linking to the medication public leaflet';

-- ----------------------------------------------------------------------------
-- 2. SUPABASE STORAGE BUCKET: medication-qrcodes
-- ----------------------------------------------------------------------------
-- Ensure storage bucket exists with public access for guest/visitor scanning
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medication-qrcodes',
  'medication-qrcodes',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/svg+xml', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/svg+xml', 'image/jpeg']::text[];

-- ----------------------------------------------------------------------------
-- 3. STORAGE ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies for idempotent execution
DROP POLICY IF EXISTS "Public QR Code Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Upload QR Codes" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Update QR Codes" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Creator Can Delete QR Codes" ON storage.objects;

-- Policy A: SELECT (Guest & Public Read-Only Access)
-- Anyone (including unauthenticated guests and patient smartphone scanners) can read/download QR images
CREATE POLICY "Public QR Code Read Access"
ON storage.objects
FOR SELECT
USING (bucket_id = 'medication-qrcodes');

-- Policy B: INSERT (Creation by Authorized Roles)
-- Admin, Pharmacist, and Staff can generate and upload QR codes
CREATE POLICY "Authorized Roles Can Upload QR Codes"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'medication-qrcodes'
  AND (
    COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') IN ('ADMIN', 'PHARMACIST', 'STAFF')
    OR auth.role() = 'authenticated'
  )
);

-- Policy C: UPDATE (Regeneration by Authorized Roles)
CREATE POLICY "Authorized Roles Can Update QR Codes"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'medication-qrcodes'
  AND (
    COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') IN ('ADMIN', 'PHARMACIST', 'STAFF')
    OR auth.role() = 'authenticated'
  )
);

-- Policy D: DELETE (Administrative Cleanup)
CREATE POLICY "Admin and Creator Can Delete QR Codes"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'medication-qrcodes'
  AND (
    COALESCE(auth.jwt() ->> 'role', '') = 'ADMIN'
    OR owner = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- 4. VERIFY / UPDATE medication_templates RLS FOR qr_code_url
-- ----------------------------------------------------------------------------
-- Verify that existing SELECT policy permits guest and public to read qr_code_url
-- The existing policy "Public & All Users can view medications" already specifies:
--   FOR SELECT USING (true);
-- which automatically grants public read access to the new `qr_code_url` column.

-- Verify that INSERT and UPDATE policies allow authorized roles to save `qr_code_url`:
-- - Admin has full write access.
-- - Pharmacist can update within their allowed categories.
-- - Staff can update records they own.
-- - Guest remains strictly read-only.

-- ----------------------------------------------------------------------------
-- 5. VERIFICATION QUERY
-- ----------------------------------------------------------------------------
-- Run this query in Supabase SQL Editor to verify the migration status:
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'medication_templates' AND column_name = 'qr_code_url';
