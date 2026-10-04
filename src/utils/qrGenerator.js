import QRCode from 'qrcode'
import { supabase } from '../supabaseClient'
import { uploadMedicationPdfToStorage, getDirectPdfUrl } from './pdfGenerator'

/**
 * ============================================================================
 * AUTOMATED QR CODE GENERATION & DISTRIBUTION UTILITIES
 * ============================================================================
 * Generates high-redundancy QR codes linking DIRECTLY to the medication PDF file
 * in Supabase Storage ('medication-pdfs') or zero-UI client-side PDF streamer.
 * Uploads QR code images to 'medication-qrcodes', supports PNG/SVG downloads,
 * and formats packaging sticker prints.
 */

const STORAGE_BUCKET = 'medication-qrcodes'

/**
 * Get the direct public PDF deep-link URL for a medication.
 * Points to the direct Supabase Storage .pdf URL or instant /download-pdf/:id route.
 */
export function getMedicationLeafletUrl(medId, directPdfUrl = null) {
  if (directPdfUrl && (directPdfUrl.startsWith('http://') || directPdfUrl.startsWith('https://'))) {
    return directPdfUrl
  }
  return getDirectPdfUrl(medId)
}

/**
 * Generate a high-resolution Base64 PNG Data URL for a given URL or text.
 * Error correction level 'H' (High - ~30% damage recovery) is ideal for medical packaging.
 */
export async function generateQRCodeDataURL(text, customOptions = {}) {
  const options = {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    quality: 0.95,
    margin: 2,
    width: 600,
    color: {
      dark: '#0f172a', // Deep slate for crisp scanning
      light: '#ffffff'
    },
    ...customOptions
  }

  try {
    return await QRCode.toDataURL(text, options)
  } catch (err) {
    console.error('QR Code generation failed:', err)
    throw err
  }
}

/**
 * Generate an SVG string of the QR code for vector graphics and printing.
 */
export async function generateQRCodeSVG(text, customOptions = {}) {
  const options = {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 600,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    },
    ...customOptions
  }

  try {
    return await QRCode.toString(text, options)
  } catch (err) {
    console.error('QR Code SVG generation failed:', err)
    throw err
  }
}

/**
 * Upload generated QR code to Supabase Storage ('medication-qrcodes').
 * Gracefully falls back to Base64 Data URL if storage is unprovisioned.
 */
export async function uploadQRCodeToStorage(medId, dataUrl) {
  if (!medId || !dataUrl) return dataUrl

  try {
    // Convert Data URL to binary Blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()

    const filePath = `med_${medId}_qr.png`

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: true
      })

    if (uploadError) {
      console.warn(`Supabase Storage QR upload notice (${uploadError.message}). Using Base64 Data URL.`)
      return dataUrl
    }

    // Get public URL from Supabase Storage
    const { data } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath)

    if (data?.publicUrl) {
      return data.publicUrl
    }

    return dataUrl
  } catch (err) {
    console.warn('Supabase storage QR upload error. Using Base64 fallback:', err)
    return dataUrl
  }
}

/**
 * Automated end-to-end Direct PDF & QR Code generation for a medication:
 * 1. Generates Landscape A4 PDF and uploads to 'medication-pdfs' bucket
 * 2. Resolves direct .pdf URL (Supabase Storage public URL or /download-pdf/:id)
 * 3. Encodes direct .pdf URL into QR Code (PNG & SVG)
 * 4. Uploads QR image to 'medication-qrcodes' bucket
 * 5. Returns directPdfUrl for saving into medication_templates.qr_code_url
 */
export async function generateAndDistributeQRCode(medInput) {
  const isObject = typeof medInput === 'object' && medInput !== null
  const medId = isObject ? medInput.id : medInput
  const medData = isObject ? medInput : null

  let directPdfUrl = null

  // 1. If drug data is provided, upload PDF to Supabase Storage 'medication-pdfs'
  if (medId && medData) {
    try {
      directPdfUrl = await uploadMedicationPdfToStorage(medId, medData)
    } catch (e) {
      console.warn('PDF storage upload failed, will use fallback direct route:', e)
    }
  }

  // 2. If already saved as a valid storage URL
  if (!directPdfUrl && medData?.qr_code_url && medData.qr_code_url.startsWith('http') && medData.qr_code_url.includes('.pdf')) {
    directPdfUrl = medData.qr_code_url
  }

  // 3. Fallback to client-side zero-UI download route
  if (!directPdfUrl) {
    directPdfUrl = getDirectPdfUrl(medId)
  }

  // 4. Generate QR code encoding the DIRECT PDF URL
  const dataUrl = await generateQRCodeDataURL(directPdfUrl)
  const svgString = await generateQRCodeSVG(directPdfUrl)
  const qrStorageUrl = await uploadQRCodeToStorage(medId, dataUrl)

  return {
    leafletUrl: directPdfUrl, // Direct PDF link encoded in the QR
    directPdfUrl,
    dataUrl,
    svgString,
    finalUrl: directPdfUrl,   // Direct PDF URL to store in db (qr_code_url column)
    qrImageUrl: qrStorageUrl || dataUrl
  }
}

/**
 * Download QR Code in either PNG or SVG format.
 */
export function downloadQRCodeFile(content, filename = 'medication-qr', format = 'png') {
  if (!content) return

  const cleanName = filename.replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '_')

  if (format === 'svg') {
    const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `${cleanName}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  } else {
    // PNG (Data URL or Storage URL)
    const link = document.createElement('a')
    link.href = content
    link.download = `${cleanName}.png`
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}

/**
 * Print standard medical packaging sticker containing the QR Code.
 * Fits standard 80mm x 52mm label sticker sheets.
 */
export function printPackagingSticker(drug, qrImageSrc) {
  const printWindow = window.open('', '_blank', 'width=700,height=550')
  if (!printWindow) {
    alert('Please allow popups to print packaging stickers.')
    return
  }

  const drugName = drug?.med_name || drug?.drugName || 'Medication'
  const drugType = drug?.med_type || drug?.drugType || 'Prescription Drug'
  const drugGroup = drug?.med_group || drug?.drugGroup || 'General Pharmacy'
  const directPdfUrl = getMedicationLeafletUrl(drug?.id, drug?.qr_code_url)
  const dateStr = new Date().toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Packaging Sticker - ${drugName}</title>
        <style>
          @page {
            size: 80mm 52mm;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Sarabun", sans-serif;
          }
          body {
            background: #ffffff;
            color: #0f172a;
            padding: 5mm;
            width: 80mm;
            height: 52mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .sticker-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1.5px solid #2563eb;
            padding-bottom: 2mm;
          }
          .hospital-title {
            font-size: 8pt;
            font-weight: 800;
            color: #2563eb;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .badge-category {
            font-size: 6.5pt;
            background: #eff6ff;
            color: #1d4ed8;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: 600;
          }
          .sticker-body {
            display: flex;
            align-items: center;
            gap: 3.5mm;
            margin: 2mm 0;
          }
          .qr-box {
            width: 26mm;
            height: 26mm;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            padding: 1mm;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            background: #fff;
          }
          .qr-img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .info-box {
            flex: 1;
            min-width: 0;
          }
          .med-name {
            font-size: 11pt;
            font-weight: 800;
            line-height: 1.15;
            color: #0f172a;
            margin-bottom: 1.5mm;
            word-wrap: break-word;
          }
          .med-type {
            font-size: 7.5pt;
            color: #475569;
            font-weight: 600;
            margin-bottom: 1.5mm;
          }
          .scan-instructions {
            font-size: 6.5pt;
            color: #64748b;
            line-height: 1.25;
            background: #f8fafc;
            border-left: 2px solid #2563eb;
            padding: 1.5mm 2mm;
            border-radius: 2px;
          }
          .sticker-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 5.5pt;
            color: #94a3b8;
            border-top: 1px dashed #e2e8f0;
            padding-top: 1mm;
          }
          .url-preview {
            max-width: 50mm;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          @media screen {
            body {
              border: 1px solid #e2e8f0;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
              margin: 20px auto;
            }
          }
        </style>
      </head>
      <body>
        <div class="sticker-header">
          <span class="hospital-title">PSU Hospital · PIL</span>
          <span class="badge-category">${drugGroup}</span>
        </div>

        <div class="sticker-body">
          <div class="qr-box">
            <img class="qr-img" src="${qrImageSrc}" alt="Medication QR Code" />
          </div>
          <div class="info-box">
            <div class="med-name">${drugName}</div>
            <div class="med-type">${drugType}</div>
            <div class="scan-instructions">
              สแกน QR Code ด้วยกล้องสมาร์ทโฟน เพื่อเปิดเอกสารกำกับยาฉบับ PDF โดยตรงทันที
            </div>
          </div>
        </div>

        <div class="sticker-footer">
          <span class="url-preview">${directPdfUrl}</span>
          <span>Printed: ${dateStr}</span>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 350);
          };
        </script>
      </body>
    </html>
  `

  printWindow.document.open()
  printWindow.document.write(htmlContent)
  printWindow.document.close()
}

