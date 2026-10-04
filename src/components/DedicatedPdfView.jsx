import { useState, useMemo, useEffect } from 'react'
import jsPDF from 'jspdf'
import './DedicatedPdfView.css'

export default function DedicatedPdfView({
  drug,
  loading,
  error,
  onBackToHome,
  sarabunBase64,
  topics
}) {
  const [activeTab, setActiveTab] = useState('mobile_view') // 'mobile_view' | 'pdf_preview'
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Generate Landscape A4 PDF Document
  const pdfInstance = useMemo(() => {
    if (!drug || !sarabunBase64) return null
    try {
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

      // Name Box
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.8)
      doc.rect(COL_X[0], MARGIN, COL_W, NAME_BOX_H)

      doc.setFont('Sarabun', 'bold')
      doc.setFontSize(13)
      doc.text(drug.med_name || 'ชื่อยา', COL_X[0] + COL_W / 2, MARGIN + 8, { align: 'center' })

      doc.setFont('Sarabun', 'normal')
      doc.setFontSize(10)
      doc.text(drug.med_group || '', COL_X[0] + COL_W / 2, MARGIN + 16, { align: 'center' })
      doc.text(drug.med_type || 'ใส่ชนิดยา', COL_X[0] + COL_W / 2, MARGIN + 23, { align: 'center' })

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

      const contents = drug.contents || Array(8).fill('')

      let y1 = BODY_TOP_C1
      y1 = drawSectionHeader(COL_X[0], y1, COL_W, topics[1])
      y1 = drawContent(COL_X[0], y1, COL_W, contents[1], BODY_BOT - 40)
      y1 = drawSectionHeader(COL_X[0], y1, COL_W, topics[2])
      drawContent(COL_X[0], y1, COL_W, contents[2], BODY_BOT)

      let y2 = BODY_TOP
      y2 = drawSectionHeader(COL_X[1], y2, COL_W, topics[3])
      y2 = drawContent(COL_X[1], y2, COL_W, contents[3], BODY_BOT - 45)
      y2 = drawSectionHeader(COL_X[1], y2, COL_W, topics[4])
      drawContent(COL_X[1], y2, COL_W, contents[4], BODY_BOT)

      let y3 = BODY_TOP
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[5])
      y3 = drawContent(COL_X[2], y3, COL_W, contents[5], BODY_BOT - 60)
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[6])
      y3 = drawContent(COL_X[2], y3, COL_W, contents[6], BODY_BOT - 35)
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, topics[7])
      drawContent(COL_X[2], y3, COL_W, contents[7], BODY_BOT - 20)

      // Warning Footer Box
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
    } catch (err) {
      console.error('PDF Build error:', err)
      return null
    }
  }, [drug, sarabunBase64, topics])

  // Create Blob URL for PDF Embed
  useEffect(() => {
    let currentUrl = null
    if (pdfInstance) {
      setGeneratingPdf(true)
      try {
        const blob = pdfInstance.output('blob')
        currentUrl = URL.createObjectURL(blob)
        setPdfBlobUrl(currentUrl)
      } catch (err) {
        console.warn('PDF blob generation warning:', err)
      } finally {
        setGeneratingPdf(false)
      }
    }
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [pdfInstance])

  // Download PDF file directly
  const handleDownloadPdf = () => {
    if (pdfInstance) {
      pdfInstance.save(`ฉลากยา_${drug?.med_name || 'PIL'}.pdf`)
    }
  }

  // Share / Copy Link
  const handleShareLink = () => {
    const url = window.location.href
    if (navigator.share) {
      navigator.share({
        title: `ฉลากยา: ${drug?.med_name || 'Medication'}`,
        text: `เอกสารกำกับยาสำหรับผู้ป่วย: ${drug?.med_name || ''}`,
        url: url
      }).catch(() => {
        // User dismissed share dialog
      })
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2200)
      })
    } else {
      prompt('คัดลอกลิงก์นี้:', url)
    }
  }

  // --- Render Loading State ---
  if (loading) {
    return (
      <div className="dedicated-pdf-page">
        <div className="dedicated-state-container">
          <div className="dedicated-spinner"></div>
          <h2 className="dedicated-state-title">กำลังโหลดเอกสารฉลากยา...</h2>
          <p className="dedicated-state-desc">Patient Information Leaflet (PIL) · กำลังดึงข้อมูลจากระบบฐานข้อมูลกลาง</p>
        </div>
      </div>
    )
  }

  // --- Render Error State ---
  if (error || !drug) {
    return (
      <div className="dedicated-pdf-page">
        <div className="dedicated-state-container">
          <div style={{ color: '#ef4444', marginBottom: '14px' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h2 className="dedicated-state-title">ไม่พบเอกสารฉลากยานี้ในระบบ</h2>
          <p className="dedicated-state-desc">
            {error || 'รหัสยาไม่ถูกต้อง หรือเอกสารอาจถูกปรับปรุง กรุณากลับสู่หน้าหลักเพื่อค้นหาข้อมูลยา'}
          </p>
          <button className="dedicated-btn-retry" onClick={onBackToHome}>
            กลับหน้าหลัก (Back to Home)
          </button>
        </div>
      </div>
    )
  }

  const contents = drug.contents || Array(8).fill('')

  return (
    <div className="dedicated-pdf-page">
      {/* --- Minimalist Sticky Header --- */}
      <header className="dedicated-pdf-header">
        <div className="dedicated-header-left">
          <div className="dedicated-logo-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
          </div>
          <div className="dedicated-header-titles">
            <div className="dedicated-header-app-title">เอกสารกำกับยาสำหรับผู้ป่วย</div>
            <div className="dedicated-header-sub-title">Patient Information Leaflet (PIL)</div>
          </div>
        </div>

        {/* View Mode Toggle Pill */}
        <div className="dedicated-mode-switcher">
          <button
            className={`mode-tab-btn ${activeTab === 'mobile_view' ? 'active' : ''}`}
            onClick={() => setActiveTab('mobile_view')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
              <path d="M12 18h.01" />
            </svg>
            <span>อ่านบนมือถือ</span>
          </button>
          <button
            className={`mode-tab-btn ${activeTab === 'pdf_preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('pdf_preview')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>เอกสาร PDF</span>
          </button>
        </div>
      </header>

      {/* --- Main Document Body --- */}
      <main className="dedicated-pdf-content">
        {activeTab === 'mobile_view' ? (
          /* Mobile-Optimized Structured PIL Card */
          <div className="dedicated-paper-card">
            {/* Drug Identification Box */}
            <div className="dedicated-drug-box">
              <div className="dedicated-drug-name">{drug.med_name || 'ชื่อยา'}</div>
              <div className="dedicated-drug-meta-row">
                {drug.med_group && <span className="dedicated-badge-group">{drug.med_group}</span>}
                {drug.med_type && <span className="dedicated-badge-type">{drug.med_type}</span>}
              </div>
            </div>

            {/* Verification Tag */}
            <div className="dedicated-verified-strip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>ข้อมูลทางการแพทย์ ได้รับการตรวจสอบตามมาตรฐาน คณะเภสัชศาสตร์ ม.อ.</span>
            </div>

            {/* 7 Standard Clinical Topics */}
            <div className="dedicated-topics-list">
              {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                const text = contents[num] || ''
                const lines = text.trim().split('\n').filter(l => l.trim())

                return (
                  <div key={num} className="dedicated-topic-card">
                    <div className="dedicated-topic-header">
                      <span>{topics[num]}</span>
                    </div>
                    <div className="dedicated-topic-body">
                      {lines.length > 0 ? (
                        <ul className="dedicated-bullet-list">
                          {lines.map((line, idx) => (
                            <li key={idx} className="dedicated-bullet-item">
                              <span className="dedicated-bullet-dot">•</span>
                              <span>{line.trim()}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="dedicated-empty-content">- ไม่มีข้อมูลระบุ -</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Crucial Patient Warning Box (Red Box) */}
            <div className="dedicated-warning-box">
              <div className="dedicated-warning-title">เอกสารนี้เป็นข้อมูลโดยย่อ</div>
              <div className="dedicated-warning-sub">หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร</div>
            </div>

            {/* Footer Attribution */}
            <footer className="dedicated-source-footer">
              <span className="dedicated-psu-tag">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                PSU · Prince of Songkla University
              </span>
              <span>Patient Information Leaflet (PIL) · Last Updated: {drug.updated_at ? new Date(drug.updated_at).toLocaleDateString('th-TH') : 'ล่าสุด'}</span>
            </footer>
          </div>
        ) : (
          /* Fullscreen Real PDF Preview */
          <div>
            {generatingPdf ? (
              <div className="dedicated-state-container">
                <div className="dedicated-spinner"></div>
                <p>กำลังเตรียมไฟล์ PDF...</p>
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                title={`PDF Viewer - ${drug.med_name}`}
                src={`${pdfBlobUrl}#toolbar=0&navpanes=0&view=FitH`}
                className="dedicated-pdf-viewer-frame"
              />
            ) : (
              <div className="dedicated-state-container">
                <p>ไม่สามารถสร้างการแสดงผลไฟล์ PDF ได้</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* --- Floating Action Bar (Sticky at Screen Bottom) --- */}
      <nav className="dedicated-fab-bar" aria-label="Quick Actions">
        <button
          className="fab-btn-download"
          onClick={handleDownloadPdf}
          title="ดาวน์โหลดเอกสาร PDF ลงในเครื่อง"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>ดาวน์โหลด PDF</span>
        </button>

        <button
          className="fab-btn-home"
          onClick={onBackToHome}
          title="ค้นหายาตัวอื่น หรือกลับหน้าหลัก"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span>หน้าหลัก</span>
        </button>

        <button
          className={`fab-btn-share ${copiedLink ? 'copied' : ''}`}
          onClick={handleShareLink}
          title="คัดลอกลิงก์หรือแชร์ฉลากยา"
          aria-label="แชร์ลิงก์"
        >
          {copiedLink ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
          )}
        </button>
      </nav>
    </div>
  )
}
