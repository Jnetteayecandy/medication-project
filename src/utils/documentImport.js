/**
 * ============================================================================
 * DOCUMENT IMPORT (Image / PDF / Word -> editable PIL fields)
 * ============================================================================
 * - Images (PNG/JPG/...): OCR with Tesseract (Thai + English)
 * - PDF: text layer via pdf.js; pages without text (scans) fall back to OCR
 * - Word (.docx): text via mammoth
 * The extracted text is split into the drug name/type and the 7 PIL sections.
 * Heavy libraries are loaded on demand so they don't slow down the rest of the app.
 */

// Thai characters that attach to the previous letter (vowels above/below, tone marks)
const THAI_COMBINING = '\u0E31\u0E34-\u0E3A\u0E47-\u0E4E'
const THAI_CONSONANT = '\u0E01-\u0E2E'

/**
 * Repair Thai text copied/extracted from PDFs, e.g. "ใช ้ยา" -> "ใช้ยา", "ส าคัญ" -> "สำคัญ".
 */
export function normalizeThaiText(text) {
  if (!text) return ''
  return String(text)
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // stray space before an attached vowel / tone mark
    .replace(new RegExp(`[ \\t\\u00A0]+([${THAI_COMBINING}])`, 'g'), '$1')
    // "ำ" broken into nikhahit + "า" or "ส า": consonant (+ tone mark) + space + า
    .replace(new RegExp(`([${THAI_CONSONANT}][\\u0E48-\\u0E4B]?)\\u0E4D?[ \\t\\u00A0]+\\u0E32`, 'g'), '$1ำ')
    .replace(/ํา/g, 'ำ')
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

let tesseractWorkerPromise = null

async function getOcrWorker(onProgress) {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js')
      const worker = await createWorker(['tha', 'eng'], 1, {
        logger: (m) => {
          if (!getOcrWorker.onProgress) return
          if (m.status === 'recognizing text') {
            getOcrWorker.onProgress({ stage: 'Reading text (OCR)', progress: m.progress })
          } else if (m.status) {
            getOcrWorker.onProgress({ stage: 'Loading OCR engine', progress: m.progress ?? 0 })
          }
        }
      })
      // Columns are split beforehand; treat each as one column of text of varying sizes
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
      return worker
    })().catch((err) => {
      tesseractWorkerPromise = null
      throw err
    })
  }
  getOcrWorker.onProgress = onProgress
  return tesseractWorkerPromise
}

async function loadImage(source) {
  if (source instanceof HTMLCanvasElement) return source
  const url = URL.createObjectURL(source)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Prepare an image for OCR. Returns one canvas per text column:
 * - upscale small images (Thai vowel/tone marks are tiny) and convert to grayscale
 * - split multi-column layouts (like the 3-column PIL) at the blank vertical gutters,
 *   so each column is read top-to-bottom instead of across the page
 * - invert rows that are mostly dark (white headings on navy bars) so all text is dark-on-light
 */
async function prepareForOcr(source) {
  const img = await loadImage(source)
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  const scale = Math.min(3, Math.max(1, 2400 / Math.max(w0, 1)))
  const w = Math.round(w0 * scale)
  const h = Math.round(h0 * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  const px = ctx.getImageData(0, 0, w, h).data
  const lum = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) {
    lum[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  }
  const INK = 150

  // 1. Column gutters: x positions with (almost) no ink from top to bottom
  const inkPerX = new Uint32Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (lum[y * w + x] < INK) inkPerX[x]++
  }
  const blank = (x) => inkPerX[x] <= h * 0.004
  const minGutter = Math.max(6, Math.round(w * 0.008))
  const minColumn = w * 0.15
  const cuts = []
  for (let x = 0; x < w;) {
    if (!blank(x)) { x++; continue }
    let end = x
    while (end < w && blank(end)) end++
    if (end - x >= minGutter && x > 0 && end < w) cuts.push(Math.round((x + end) / 2))
    x = end
  }
  const bounds = []
  let start = 0
  for (const c of cuts) {
    if (c - start >= minColumn && w - c >= minColumn) { bounds.push([start, c]); start = c }
  }
  bounds.push([start, w])

  // 2. One grayscale canvas per column, with dark bars inverted row by row
  return bounds.map(([x0, x1]) => {
    const cw = x1 - x0
    const col = document.createElement('canvas')
    col.width = cw
    col.height = h
    const cctx = col.getContext('2d')
    const out = cctx.createImageData(cw, h)
    for (let y = 0; y < h; y++) {
      let dark = 0
      for (let x = x0; x < x1; x++) if (lum[y * w + x] < INK) dark++
      const invert = dark > cw * 0.5
      for (let x = x0; x < x1; x++) {
        const v = invert ? 255 - lum[y * w + x] : lum[y * w + x]
        const o = (y * cw + (x - x0)) * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v
        out.data[o + 3] = 255
      }
    }
    cctx.putImageData(out, 0, 0)
    return col
  })
}

async function ocrImage(source, onProgress) {
  onProgress?.({ stage: 'Preparing image', progress: 0 })
  const columns = await prepareForOcr(source)
  const texts = []
  for (let i = 0; i < columns.length; i++) {
    const worker = await getOcrWorker((p) => onProgress?.({
      stage: columns.length > 1 ? `${p.stage} – column ${i + 1} of ${columns.length}` : p.stage,
      progress: (i + (p.progress || 0)) / columns.length
    }))
    const { data } = await worker.recognize(columns[i])
    texts.push(data.text || '')
  }
  return cleanOcrText(texts.join('\n'))
}

// Words whose tone/vowel marks OCR commonly drops in Thai medicine leaflets
const OCR_WORD_FIXES = [
  [/ยานี(?![\u0E48-\u0E4B])/g, 'ยานี้'],
  [/ชัวโมง/g, 'ชั่วโมง'],
  [/ครัง(?![\u0E48-\u0E4B])/g, 'ครั้ง'],
  [/ทัวไป/g, 'ทั่วไป'],
  [/ยาอืน/g, 'ยาอื่น'],
  [/อืนๆ/g, 'อื่นๆ'],
  [/เมือไร/g, 'เมื่อไร'],
  [/ชือว่า/g, 'ชื่อว่า'],
  [/ทีแนะนำ/g, 'ที่แนะนำ'],
  [/ทีต้อง/g, 'ที่ต้อง'],
  [/ทีอาจ/g, 'ที่อาจ'],
  [/ทีได้/g, 'ที่ได้'],
  [/ทีไม่/g, 'ที่ไม่'],
  [/ทีนึก/g, 'ที่นึก']
]

/**
 * Tidy raw OCR output: drop noise lines (e.g. leftovers of coloured heading bars),
 * turn misread bullet symbols into "•", and fix commonly dropped Thai marks.
 */
function cleanOcrText(text) {
  return normalizeThaiText(text)
    .split('\n')
    .map(line => line.replace(/^\s*[+«»"'“”.,·*~=-]+\s+/, '• ').trimEnd())
    .filter(line => {
      if (!line.trim()) return true
      // keep lines with at least one real word (3+ letters/digits)
      return /[\u0E01-\u0E4EA-Za-z0-9]{3,}/.test(line)
    })
    .map(line => OCR_WORD_FIXES.reduce((acc, [re, to]) => acc.replace(re, to), line))
    .join('\n')
}

async function extractFromPdf(file, onProgress) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.({ stage: `Reading PDF page ${i} of ${pdf.numPages}`, progress: (i - 1) / pdf.numPages })
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    let pageText = ''
    for (const item of content.items) {
      pageText += item.str
      if (item.hasEOL) pageText += '\n'
    }

    // Scanned page (no text layer): render it and OCR it
    if (pageText.replace(/\s/g, '').length < 20) {
      const viewport = page.getViewport({ scale: 2.5 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise
      pageText = await ocrImage(canvas, (p) => onProgress?.({
        stage: `OCR page ${i} of ${pdf.numPages}`,
        progress: (i - 1 + (p.progress || 0)) / pdf.numPages
      }))
    }
    pages.push(pageText)
  }
  return pages.join('\n')
}

async function extractFromDocx(file) {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value || ''
}

export const ACCEPTED_IMPORT_TYPES = '.docx,.pdf,image/png,image/jpeg,image/webp,image/bmp,image/gif'

/**
 * Extract plain text from an image, PDF or .docx file.
 * onProgress({ stage, progress }) is called with progress 0..1.
 */
export async function extractTextFromFile(file, onProgress) {
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  let text

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    text = await extractFromPdf(file, onProgress)
  } else if (name.endsWith('.docx') || type.includes('wordprocessingml')) {
    onProgress?.({ stage: 'Reading Word document', progress: 0.5 })
    text = await extractFromDocx(file)
  } else if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/.test(name)) {
    text = await ocrImage(file, onProgress)
  } else if (name.endsWith('.doc')) {
    throw new Error('Old Word files (.doc) are not supported. Please save the file as .docx and try again.')
  } else {
    throw new Error('Unsupported file type. Please use an image (PNG/JPG), a PDF, or a Word (.docx) file.')
  }

  onProgress?.({ stage: 'Done', progress: 1 })
  return normalizeThaiText(text)
}

// ---------------------------------------------------------------------------
// Splitting text into PIL fields
// ---------------------------------------------------------------------------

const SECTION_KEYWORDS = [
  null,
  ['ยานี้คืออะไร'],
  ['ข้อควรรู้ก่อนใช้ยา', 'ควรรู้ก่อนใช้ยา'],
  ['วิธีใช้ยา'],
  ['ข้อควรปฏิบัติระหว่างใช้ยา', 'ปฏิบัติระหว่างใช้ยา'],
  ['อันตรายที่อาจเกิดจากยา', 'อันตรายที่อาจเกิด'],
  ['ควรเก็บยาอย่างไร', 'เก็บยาอย่างไร'],
  ['ลักษณะและส่วนประกอบของยา', 'ส่วนประกอบของยา']
]

const FOOTER_RE = /เอกสารนี้เป็นข้อมูลโดยย่อ|หากมีข้อสงสัยให้ปรึกษา/
const DOSAGE_FORM_RE = /ชนิด|ยาเม็ด|แคปซูล|ยาน้ำ|ครีม|ยาฉีด|ยาหยอด|ยาผง|ขี้ผึ้ง|เจล|ยาพ่น|tablet|capsule|syrup|cream|injection/i

/**
 * Is this line one of the 7 section headings? Either "N. <heading>" or a line that is
 * (almost) only the heading text, so body sentences mentioning e.g. "วิธีใช้ยา" don't match.
 */
function sectionForLine(line) {
  const compact = line.replace(/\s+/g, '').replace(/^[\u2022\u00B7\uF0B7*-]+/, '')
  if (compact.length > 60) return 0
  const numbered = compact.match(/^([1-7])[.)](?!\d)/)
  for (let k = 1; k <= 7; k++) {
    for (const kw of SECTION_KEYWORDS[k]) {
      if (!compact.includes(kw)) continue
      if (numbered && Number(numbered[1]) === k) return k
      if (compact.length <= kw.length + 4) return k
    }
  }
  return 0
}

function tidyLine(line) {
  return line
    .replace(/^[\s•●▪◦·*-]+/, (m) => (m.trim() ? '• ' : ''))
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * When a section uses bullets, a line without a bullet (and not a "2.1" sub-heading)
 * is the wrapped continuation of the previous line, e.g. "...ทำงานผิด" + "ปกติ".
 */
function joinWrappedLines(lines) {
  if (!lines.some(l => l.startsWith('• '))) return lines
  const out = []
  for (const line of lines) {
    const isItem = line.startsWith('• ') || /^\d+\.\d+/.test(line)
    if (isItem || out.length === 0) {
      out.push(line)
    } else {
      const prev = out[out.length - 1]
      const thaiJoin = /[\u0E00-\u0E7F]$/.test(prev) && /^[\u0E00-\u0E7F]/.test(line)
      out[out.length - 1] = thaiJoin ? prev + line : `${prev} ${line}`
    }
  }
  return out
}

/**
 * Split extracted text into { med_name, med_type, contents[0..7] }.
 * Text before the first section heading is treated as the drug name / dosage form block.
 */
export function parsePilText(rawText) {
  const lines = normalizeThaiText(rawText)
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !FOOTER_RE.test(l))

  const header = []
  const sections = Array.from({ length: 8 }, () => [])
  let current = 0

  for (const line of lines) {
    const k = sectionForLine(line)
    // A sub-heading like "3.2 ..." also tells us we are in section 3 (helps when OCR
    // misreads the section heading itself)
    const sub = line.match(/^\s*([1-7])\.(\d)\s/)
    if (!k && sub && Number(sub[1]) > current) current = Number(sub[1])
    if (k) {
      // Heading lines are short (<= 60 chars), so the whole line is the heading
      current = k
      continue
    }
    if (current === 0) header.push(line)
    else sections[current].push(tidyLine(line))
  }

  // Name = header lines before the drug group "(...)" / dosage form line (max 3 lines)
  const nameLines = []
  for (const l of header) {
    if (nameLines.length && (/\(.*\)/.test(l) || DOSAGE_FORM_RE.test(l))) break
    nameLines.push(l)
    if (nameLines.length === 3) break
  }
  const medName = nameLines.join(' ')
  const typeLine = header.slice(nameLines.length).find(l => DOSAGE_FORM_RE.test(l)) || ''
  const foundSections = sections.filter((s, i) => i > 0 && s.length > 0).length

  const contents = sections.map(s => joinWrappedLines(s.filter(Boolean)).join('\n'))
  // No headings recognised: put everything in section 1 so nothing is lost
  if (foundSections === 0) {
    contents[1] = header.slice(nameLines.length).map(tidyLine).join('\n')
  }

  return {
    med_name: medName,
    med_type: typeLine,
    contents,
    foundSections
  }
}
