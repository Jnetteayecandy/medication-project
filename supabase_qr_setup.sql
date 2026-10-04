-- ============================================================================
-- SUPABASE POSTGRESQL & STORAGE MIGRATION: DIRECT PDF STORAGE & QR CODE SETUP
-- Project: Medication Label System (PIL)
-- Purpose: Support Automated Landscape A4 PDF Uploads to 'medication-pdfs' bucket,
--          Deep-Linking QR Codes directly to PDF URLs, and Public Storage RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DATABASE SCHEMA UPDATES: medication_templates
-- ----------------------------------------------------------------------------
-- Add `qr_code_url` column to store the direct Supabase Storage public PDF URL
-- (e.g., https://[project-ref].supabase.co/storage/v1/object/public/medication-pdfs/med_123.pdf)
ALTER TABLE IF EXISTS public.medication_templates
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT;

-- Also add `pdf_url` as an alias column if needed for future extensions
ALTER TABLE IF EXISTS public.medication_templates
  ADD COLUMN IF NOT EXISTS pdf_url TEXT;

COMMENT ON COLUMN public.medication_templates.qr_code_url IS 
  'Direct public URL of the medication PDF file in Supabase Storage or fallback download route';

COMMENT ON COLUMN public.medication_templates.pdf_url IS 
  'Public URL of the generated A4 PDF leaflet document stored in Supabase Storage';

-- ----------------------------------------------------------------------------
-- 2. SUPABASE STORAGE BUCKET: medication-pdfs (Direct PDF Storage)
-- ----------------------------------------------------------------------------
-- Bucket for storing generated landscape A4 Patient Information Leaflets (PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medication-pdfs',
  'medication-pdfs',
  true,
  10485760, -- 10MB limit
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- ----------------------------------------------------------------------------
-- 3. SUPABASE STORAGE BUCKET: medication-qrcodes (QR Image Storage)
-- ----------------------------------------------------------------------------
-- Bucket for storing high-resolution QR code images (PNG/SVG)
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
-- 4. STORAGE ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies for idempotent execution
DROP POLICY IF EXISTS "Public PDF Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Upload PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Update PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Creator Can Delete PDFs" ON storage.objects;

DROP POLICY IF EXISTS "Public QR Code Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Upload QR Codes" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Roles Can Update QR Codes" ON storage.objects;
DROP POLICY IF EXISTS "Admin and Creator Can Delete QR Codes" ON storage.objects;

-- Policy A: SELECT (Guest & Public Read-Only Access for PDFs and QR Codes)
-- Any patient scanning with smartphone camera can open/download the PDF directly
CREATE POLICY "Public PDF Read Access"
ON storage.objects
FOR SELECT
USING (bucket_id = 'medication-pdfs');

CREATE POLICY "Public QR Code Read Access"
ON storage.objects
FOR SELECT
USING (bucket_id = 'medication-qrcodes');

-- Policy B: INSERT (Upload by Authorized Roles or Authenticated Users)
-- Admin, Pharmacist, and Staff can generate and upload PDFs & QR codes
CREATE POLICY "Authorized Roles Can Upload PDFs"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'medication-pdfs'
  AND (
    COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') IN ('ADMIN', 'PHARMACIST', 'STAFF')
    OR auth.role() = 'authenticated'
  )
);

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

-- Policy C: UPDATE (Regeneration and Replacement)
CREATE POLICY "Authorized Roles Can Update PDFs"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'medication-pdfs'
  AND (
    COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') IN ('ADMIN', 'PHARMACIST', 'STAFF')
    OR auth.role() = 'authenticated'
  )
);

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
CREATE POLICY "Admin and Creator Can Delete PDFs"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'medication-pdfs'
  AND (
    COALESCE(auth.jwt() ->> 'role', '') = 'ADMIN'
    OR owner = auth.uid()
  )
);

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
-- 5. VERIFICATION QUERIES
-- ----------------------------------------------------------------------------
-- Run these queries in Supabase SQL Editor to verify setup status:
-- Check columns:
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'medication_templates' AND column_name IN ('qr_code_url', 'pdf_url');

-- Check storage buckets:
SELECT id, name, public, file_size_limit, allowed_mime_types 
FROM storage.buckets 
WHERE id IN ('medication-pdfs', 'medication-qrcodes');

