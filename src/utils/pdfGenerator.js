import jsPDF from 'jspdf'
import { sarabunBase64 } from '../thaiFont'
import { supabase } from '../supabaseClient'

/**
 * ============================================================================
 * MEDICATION PDF GENERATION & STORAGE UTILITIES
 * ============================================================================
 * Generates official landscape A4 Patient Information Leaflet (PIL) PDFs
 * with Sarabun font, uploads them directly to Supabase Storage ('medication-pdfs'),
 * and generates direct .pdf public links for immediate smartphone scanning.
 */

export const PIL_TOPIC_NAMES = [
  "",
  "1. ยานี้คืออะไร",
  "2. ข้อควรรู้ก่อนใช้ยา",
  "3. วิธีใช้ยา",
  "4. ข้อควรปฏิบัติระหว่างใช้ยา",
  "5. อันตรายที่อาจเกิดจากยา",
  "6. ควรเก็บยาอย่างไร",
  "7. ลักษณะและส่วนประกอบของยา"
]

export const PDF_STORAGE_BUCKET = 'medication-pdfs'

/**
 * Build the jsPDF document object in landscape A4 format with 3-column layout.
 */
export function generateMedicationPdfDoc(drug, topics = PIL_TOPIC_NAMES) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun.ttf', sarabunBase64)
  doc.addFont('Sarabun.ttf', 'Sarabun', 'normal')
  doc.addFont('Sarabun.ttf', 'Sarabun', 'bold')

  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 8
  const GAP = 4
  const COL_W = (PW - MARGIN * 2 - GAP * 2) / 3
  const COL_X = [MARGIN, MARGIN + COL_W + GAP, MARGIN + (COL_W + GAP) * 2]

  const NAME_BOX_H = 28
  const BODY_TOP_C1 = MARGIN + NAME_BOX_H + 5
  const BODY_TOP = MARGIN
  const BODY_BOT = PH - MARGIN - 2

  const medName = drug?.med_name || drug?.drugName || 'ชื่อยา'
  const medGroup = drug?.med_group || drug?.drugGroup || ''
  const medType = drug?.med_type || drug?.drugType || 'ใส่ชนิดยา'
  const contents = drug?.contents || Array(8).fill('')

  // Top Box: Medication Identity (Column 1)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.8)
  doc.rect(COL_X[0], MARGIN, COL_W, NAME_BOX_H)

  doc.setFont('Sarabun', 'bold')
  doc.setFontSize(13)
  doc.text(medName, COL_X[0] + COL_W / 2, MARGIN + 8, { align: 'center' })

  doc.setFont('Sarabun', 'normal')
  doc.setFontSize(10)
  doc.text(medGroup, COL_X[0] + COL_W / 2, MARGIN + 16, { align: 'center' })
  doc.text(medType, COL_X[0] + COL_W / 2, MARGIN + 23, { align: 'center' })

  const drawSectionHeader = (x, y, w, text) => {
    doc.setFillColor(20, 20, 55)
    doc.rect(x, y, w, 7.5, 'F')
    doc.setFont('Sarabun', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(255, 255, 255)
    doc.text(text, x + w / 2, y + 5.4, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    return y + 7.5
  }

  const drawContent = (x, y, w, text, bottomLimit) => {
    doc.setFont('Sarabun', 'normal')
    doc.setFontSize(9)
    if (!text || text.trim() === '') {
      doc.setTextColor(150, 150, 150)
      doc.text('-', x + 4, y + 5)
      doc.setTextColor(0, 0, 0)
      return y + 7
    }
    const lines = text.trim().split('\n').filter(l => l.trim())
    let curY = y + 5
    for (const line of lines) {
      const wrapped = doc.splitTextToSize('• ' + line.trim(), w - 6)
      for (const wl of wrapped) {
        if (curY > bottomLimit) return curY
        doc.text(wl, x + 4, curY)
        curY += 4.5
      }
    }
    return curY + 2
  }

  // Column 1
  let y1 = BODY_TOP_C1
  y1 = drawSectionHeader(COL_X[0], y1, COL_W, topics[1] || '1. ยานี้คืออะไร')
  y1 = drawContent(COL_X[0], y1, COL_W, contents[1], BODY_BOT - 40)
  y1 = drawSectionHeader(COL_X[0], y1, COL_W, topics[2] || '2. ข้อควรรู้ก่อนใช้ยา')
  drawContent(COL_X[0], y1, COL_W, contents[2], BODY_BOT)

  // Column 2
  let y2 = BODY_TOP
  y2 = drawSectionHeader(COL_X[1], y2, COL_W, topics[3] || '3. วิธีใช้ยา')
  y2 = drawContent(COL_X[1], y2, COL_W, contents[3], BODY_BOT - 45)
  y2 = drawSectionHeader(COL_X[1], y2, COL_W, topics[4] || '4. ข้อควรปฏิบัติระหว่างใช้ยา')
  drawContent(COL_X[1], y2, COL_W, contents[4], BODY_BOT)

  // Column 3
  let y3 = BODY_TOP
  y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[5] || '5. อันตรายที่อาจเกิดจากยา')
  y3 = drawContent(COL_X[2], y3, COL_W, contents[5], BODY_BOT - 60)
  y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[6] || '6. ควรเก็บยาอย่างไร')
  y3 = drawContent(COL_X[2], y3, COL_W, contents[6], BODY_BOT - 35)
  y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[7] || '7. ลักษณะและส่วนประกอบของยา')
  drawContent(COL_X[2], y3, COL_W, contents[7], BODY_BOT - 20)

  // Column 3 Footer Notice Box
  const FY = PH - MARGIN - 16
  doc.setDrawColor(200, 0, 0)
  doc.setLineWidth(0.8)
  doc.rect(COL_X[2], FY, COL_W, 16)
  doc.setFont('Sarabun', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(200, 0, 0)
  doc.text('เอกสารนี้เป็นข้อมูลโดยย่อ', COL_X[2] + COL_W / 2, FY + 6, { align: 'center' })
  doc.text('หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร', COL_X[2] + COL_W / 2, FY + 12, { align: 'center' })

  return doc
}

/**
 * Generate a binary PDF Blob for a medication.
 */
export function generateMedicationPdfBlob(drug, topics = PIL_TOPIC_NAMES) {
  const doc = generateMedicationPdfDoc(drug, topics)
  return doc.output('blob')
}

/**
 * Upload generated PDF to Supabase Storage bucket 'medication-pdfs'.
 * Returns the public direct .pdf URL, or null if storage is unprovisioned / offline.
 */
export async function uploadMedicationPdfToStorage(medId, drug, topics = PIL_TOPIC_NAMES) {
  if (!medId || !drug) return null

  try {
    const pdfBlob = generateMedicationPdfBlob(drug, topics)
    const filePath = `med_${medId}.pdf`

    const { error: uploadError } = await supabase.storage
      .from(PDF_STORAGE_BUCKET)
      .upload(filePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (uploadError) {
      console.warn(`Supabase Storage PDF upload notice (${uploadError.message}). Using fallback direct link.`)
      return null
    }

    const { data } = supabase.storage
      .from(PDF_STORAGE_BUCKET)
      .getPublicUrl(filePath)

    if (data?.publicUrl) {
      return data.publicUrl
    }
    return null
  } catch (err) {
    console.warn('Supabase Storage PDF upload error:', err)
    return null
  }
}

/**
 * Resolve direct PDF URL:
 * - If storage URL is provided and valid, returns it directly.
 * - Otherwise returns client-side zero-UI download route `/download-pdf/:id`.
 */
export function getDirectPdfUrl(medId, storagePdfUrl = null) {
  if (storagePdfUrl && (storagePdfUrl.startsWith('http://') || storagePdfUrl.startsWith('https://'))) {
    return storagePdfUrl
  }

  let origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (typeof import.meta !== 'undefined') {
    if (import.meta.env?.VITE_PUBLIC_URL) {
      origin = import.meta.env.VITE_PUBLIC_URL.replace(/\/+$/, '')
    } else if (import.meta.env?.VITE_APP_URL) {
      origin = import.meta.env.VITE_APP_URL.replace(/\/+$/, '')
    }
  }

  return `${origin}/download-pdf/${encodeURIComponent(medId)}`
}
