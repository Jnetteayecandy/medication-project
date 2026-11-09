import jsPDF from 'jspdf'
import { sarabunBase64 } from '../thaiFont'
import { supabase } from '../supabaseClient'
import { normalizeThaiText } from './documentImport'

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

// ---------------------------------------------------------------------------
// Text helpers (Thai-aware wrapping & content parsing)
// ---------------------------------------------------------------------------

const PT_TO_MM = 0.3528
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g
// Bullet-like characters, incl. Word's private-use symbol bullets (e.g. U+F0B7)
const BULLET_RE = /^[\s\u2022\u25CF\u25AA\u25E6\u2023\u00B7\u2219\u2013\u2014\-*\uF000-\uF0FF]+/
const BULLET_START_RE = /^[\s\u2022\u25CF\u25AA\u25E6\u2023\u00B7\u2219\u2013\u2014\-*\uF000-\uF0FF]/
const SUBHEADING_RE = /^\d+\.\d+\s*/
const THAI_RE = /[\u0E00-\u0E7F]/

const wordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null
const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'grapheme' })
  : null

function segmentWords(text) {
  if (wordSegmenter) return Array.from(wordSegmenter.segment(text), s => s.segment)
  return text.split(/(\s+)/).filter(Boolean)
}

function segmentGraphemes(text) {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), s => s.segment)
  return Array.from(text)
}

/**
 * Wrap text to `maxWidth` (mm) at the doc's current font settings.
 * Thai has no spaces between words, so break on dictionary word boundaries
 * (Intl.Segmenter) instead of jsPDF's space-only splitTextToSize.
 */
function wrapText(doc, text, maxWidth) {
  const lines = []
  let line = ''
  const push = () => {
    if (line.trim()) lines.push(line.trim())
    line = ''
  }

  for (const word of segmentWords(text)) {
    const candidate = line + word
    if (doc.getTextWidth(candidate) <= maxWidth) {
      line = candidate
      continue
    }
    if (line.trim()) push()
    if (doc.getTextWidth(word) <= maxWidth) {
      line = word.trimStart()
      continue
    }
    // A single word wider than the line: break by characters
    for (const g of segmentGraphemes(word)) {
      if (doc.getTextWidth(line + g) > maxWidth && line) push()
      line += g
    }
  }
  push()
  return lines.length ? lines : ['']
}

function joinContinuation(prev, next) {
  const lastChar = prev.slice(-1)
  const firstChar = next.charAt(0)
  // Thai text has no spaces inside sentences, so a hard line break inside a Thai
  // sentence is re-joined without a space; anything else gets a space.
  return THAI_RE.test(lastChar) && THAI_RE.test(firstChar) ? prev + next : `${prev} ${next}`
}

/**
 * Turn a section's raw text into items:
 *   { type: 'sub', text }    lines like "2.1 ห้ามใช้ยานี้เมื่อไร" (bold, no bullet)
 *   { type: 'bullet', text } everything else
 * Leading bullet characters are stripped (fixes "• •"). When the text uses bullets/indents
 * to start items, plain lines are treated as the continuation of the previous item
 * (fixes sentences broken across lines, e.g. pasted from Word).
 */
export function parseSectionContent(text) {
  if (!text || !text.trim()) return []
  const rawLines = normalizeThaiText(text).replace(ZERO_WIDTH_RE, '').replace(/\r/g, '').split('\n').filter(l => l.trim())
  const usesMarkers = rawLines.some(l => BULLET_START_RE.test(l))
  const items = []

  for (const raw of rawLines) {
    const hasMarker = BULLET_START_RE.test(raw)
    const clean = raw.replace(BULLET_RE, '').trim()
    if (!clean) continue

    if (SUBHEADING_RE.test(clean)) {
      items.push({ type: 'sub', text: clean })
    } else if (hasMarker || !usesMarkers || items.length === 0) {
      items.push({ type: 'bullet', text: clean })
    } else {
      const prev = items[items.length - 1]
      prev.text = joinContinuation(prev.text, clean)
    }
  }
  return items
}

/**
 * Build the jsPDF document object in landscape A4 format with 3-column layout.
 * Body font size is chosen automatically: the largest size (up to 15pt) at which
 * every column still fits on the page (min 6.5pt; anything still overflowing is clipped).
 */
export function generateMedicationPdfDoc(drug, topics = PIL_TOPIC_NAMES) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('Sarabun.ttf', sarabunBase64)
  doc.addFont('Sarabun.ttf', 'Sarabun', 'normal')
  doc.addFont('Sarabun.ttf', 'Sarabun', 'bold')

  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 9
  const GAP = 6
  const COL_W = (PW - MARGIN * 2 - GAP * 2) / 3
  const COL_X = [MARGIN, MARGIN + COL_W + GAP, MARGIN + (COL_W + GAP) * 2]
  const BODY_BOT = PH - MARGIN
  const SECTION_GAP = 4
  const FOOTER_H = 16
  const FOOTER_Y = PH - MARGIN - FOOTER_H

  const medName = normalizeThaiText(drug?.med_name || drug?.drugName || 'ชื่อยา')
  const medGroup = drug?.med_group || drug?.drugGroup || ''
  const medType = drug?.med_type || drug?.drugType || 'ใส่ชนิดยา'
  const contents = drug?.contents || Array(8).fill('')

  // --- Top box: medication identity (grows to fit long names) ---
  const BOX_PAD_X = 5
  const BOX_PAD_Y = 4
  const boxTextW = COL_W - BOX_PAD_X * 2

  let nameSize = 17
  let nameLines
  doc.setFont('Sarabun', 'bold')
  for (; nameSize >= 12; nameSize -= 0.5) {
    doc.setFontSize(nameSize)
    nameLines = wrapText(doc, medName, boxTextW)
    if (nameLines.length <= 3) break
  }
  nameSize = Math.max(nameSize, 12)
  doc.setFontSize(nameSize)
  nameLines = wrapText(doc, medName, boxTextW)
  const nameLH = nameSize * PT_TO_MM * 1.3

  const metaSize = 12
  doc.setFont('Sarabun', 'normal')
  doc.setFontSize(metaSize)
  const metaLines = [
    ...(medGroup ? wrapText(doc, medGroup, boxTextW) : []),
    ...(medType ? wrapText(doc, medType, boxTextW) : [])
  ]
  const metaLH = metaSize * PT_TO_MM * 1.35

  const nameBoxH = BOX_PAD_Y * 2 + nameLines.length * nameLH + (metaLines.length ? 1.5 + metaLines.length * metaLH : 0)

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.8)
  doc.rect(COL_X[0], MARGIN, COL_W, nameBoxH)

  let ty = MARGIN + BOX_PAD_Y + nameSize * PT_TO_MM * 0.95
  doc.setFont('Sarabun', 'bold')
  doc.setFontSize(nameSize)
  for (const l of nameLines) {
    doc.text(l, COL_X[0] + COL_W / 2, ty, { align: 'center' })
    ty += nameLH
  }
  ty += 1.5 - nameLH + metaLH
  doc.setFont('Sarabun', 'normal')
  doc.setFontSize(metaSize)
  for (const l of metaLines) {
    doc.text(l, COL_X[0] + COL_W / 2, ty, { align: 'center' })
    ty += metaLH
  }

  // --- Columns: [section index list, top Y, bottom limit] ---
  const columns = [
    { x: COL_X[0], top: MARGIN + nameBoxH + 5, bottom: BODY_BOT, sections: [1, 2] },
    { x: COL_X[1], top: MARGIN, bottom: BODY_BOT, sections: [3, 4] },
    { x: COL_X[2], top: MARGIN, bottom: FOOTER_Y - 4, sections: [5, 6, 7] }
  ]
  const parsed = contents.map(parseSectionContent)

  const BULLET_INDENT = 4
  const TEXT_INDENT = 8
  const metrics = (fs) => ({
    fs,
    headerSize: Math.min(15, fs + 1.5),
    headerH: Math.max(8, (fs + 1.5) * PT_TO_MM * 1.75),
    lineH: fs * PT_TO_MM * 1.42,
    itemGap: fs * PT_TO_MM * 0.3
  })

  // Lay out (or just measure) one section; returns the Y after it
  const layoutSection = (m, x, y, idx, draw, bottom = Infinity) => {
    const header = topics[idx] || PIL_TOPIC_NAMES[idx]
    if (draw && y + m.headerH <= bottom) {
      doc.setFillColor(20, 20, 55)
      doc.rect(x, y, COL_W, m.headerH, 'F')
      doc.setFont('Sarabun', 'bold')
      doc.setFontSize(m.headerSize)
      doc.setTextColor(255, 255, 255)
      doc.text(header, x + COL_W / 2, y + m.headerH / 2 + m.headerSize * PT_TO_MM * 0.35, { align: 'center' })
      doc.setTextColor(0, 0, 0)
    }
    let cy = y + m.headerH + 2

    const items = parsed[idx] || []
    if (items.length === 0) {
      if (draw && cy + m.lineH <= bottom) {
        doc.setFont('Sarabun', 'normal')
        doc.setFontSize(m.fs)
        doc.setTextColor(150, 150, 150)
        doc.text('-', x + BULLET_INDENT, cy + m.lineH * 0.8)
        doc.setTextColor(0, 0, 0)
      }
      return cy + m.lineH + 1
    }

    for (const item of items) {
      const isSub = item.type === 'sub'
      doc.setFont('Sarabun', isSub ? 'bold' : 'normal')
      doc.setFontSize(m.fs)
      const textX = x + (isSub ? BULLET_INDENT : TEXT_INDENT)
      const lines = wrapText(doc, item.text, COL_W - (textX - x) - 2)
      lines.forEach((line, i) => {
        const baseline = cy + m.lineH * 0.8
        // Never draw past the column's bottom (e.g. into the footer box)
        if (draw && cy + m.lineH <= bottom) {
          if (i === 0 && !isSub) doc.text('•', x + BULLET_INDENT, baseline)
          // Embedded Sarabun has no real bold face, so sub-headings use navy to stand out
          if (isSub) doc.setTextColor(30, 58, 138)
          doc.text(line, textX, baseline)
          if (isSub) doc.setTextColor(0, 0, 0)
        }
        cy += m.lineH
      })
      cy += m.itemGap
    }
    return cy
  }

  const columnFits = (m, col) => {
    let y = col.top
    for (const idx of col.sections) y = layoutSection(m, col.x, y, idx, false) + SECTION_GAP
    return y - SECTION_GAP <= col.bottom
  }

  let fs = 15
  while (fs > 6.5 && !columns.every(col => columnFits(metrics(fs), col))) fs -= 0.25
  const m = metrics(fs)

  for (const col of columns) {
    let y = col.top
    for (const idx of col.sections) y = layoutSection(m, col.x, y, idx, true, col.bottom) + SECTION_GAP
  }

  // --- Column 3 footer notice box ---
  doc.setDrawColor(200, 0, 0)
  doc.setLineWidth(0.8)
  doc.rect(COL_X[2], FOOTER_Y, COL_W, FOOTER_H)
  doc.setFont('Sarabun', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(200, 0, 0)
  doc.text('เอกสารนี้เป็นข้อมูลโดยย่อ', COL_X[2] + COL_W / 2, FOOTER_Y + 6.5, { align: 'center' })
  doc.text('หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร', COL_X[2] + COL_W / 2, FOOTER_Y + 12, { align: 'center' })
  doc.setTextColor(0, 0, 0)

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
