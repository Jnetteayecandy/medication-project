import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import jsPDF from 'jspdf'
import { sarabunBase64 } from './thaiFont'
import './App.css'

const supabaseUrl = 'https://bcehtpixbibbpmejsfyn.supabase.co'
const supabaseKey = "sb_publishable_ukt54W7gCdi70e6bSr7jzw_dPxxaTCa"
const supabase = createClient(supabaseUrl, supabaseKey)

function App() {
  const [drugGroup, setDrugGroup] = useState('')
  const [drugGroups, setDrugGroups] = useState([])
  const [drugName, setDrugName] = useState('')
  const [drugType, setDrugType] = useState('')
  const [contents, setContents] = useState(Array(8).fill(''))
  const [activeTopicForSearch, setActiveTopicForSearch] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const searchTimeoutRef = useRef(null)

  useEffect(() => {
    const fetchDrugGroups = async () => {
      const { data } = await supabase.from('drug_groups').select('name').order('id', { ascending: true })
      if (data && data.length > 0) {
        setDrugGroups(data.map(d => d.name))
        setDrugGroup(data[0].name)
      }
    }
    fetchDrugGroups()
  }, [])

  // --- ฟังก์ชันสำหรับล้างค่าทุกอย่าง ---
  const handleClearAll = () => {
    if (window.confirm("คุณต้องการล้างข้อมูลทั้งหมดใช่หรือไม่?")) {
      setDrugName('')
      setDrugType('')
      setContents(Array(8).fill(''))
      if (drugGroups.length > 0) setDrugGroup(drugGroups[0])
    }
  }

  const handleHelperSearch = async (val, topicNum) => {
    const newContents = [...contents]
    newContents[topicNum] = val
    setContents(newContents)
    setActiveTopicForSearch(topicNum)
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    const lines = val.split('\n');
    const lastLine = lines[lines.length - 1].trim();

    if (lastLine.length >= 2) { 
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const { data, error } = await supabase
            .from(`topic${topicNum}`)
            .select('name')
            .ilike('name', `%${lastLine}%`) 
            .limit(10)

          if (error) throw error
          if (data) setSuggestions(data)
        } catch (err) {
          console.error("Search Error:", err.message)
          setSuggestions([])
        }
      }, 300)
    } else {
      setSuggestions([])
    }
  }

  const selectSuggestion = (suggestionName, topicNum) => {
    const newContents = [...contents]
    const currentText = newContents[topicNum] || ''
    const lines = currentText.split('\n');
    lines.pop(); 
    lines.push(suggestionName); 
    newContents[topicNum] = lines.join('\n') + '\n';
    setContents(newContents)
    setSuggestions([]) 
    setActiveTopicForSearch(null)
  }

  const topics = [
    "",
    "หัวข้อที่ 1: ยานี้คืออะไร",
    "หัวข้อที่ 2: ข้อควรรู้ก่อนใช้ยา",
    "หัวข้อที่ 3: วิธีใช้ยา",
    "หัวข้อที่ 4: ข้อควรปฏิบัติระหว่างใช้ยา",
    "หัวข้อที่ 5: อันตรายที่อาจเกิดจากยา",
    "หัวข้อที่ 6: ควรเก็บยาอย่างไร",
    "หัวข้อที่ 7: ลักษณะและส่วนประกอบของยา"
  ]

  const handleExportPDF = () => {
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

      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.8)
      doc.rect(COL_X[0], MARGIN, COL_W, NAME_BOX_H)
      doc.setFont('Sarabun', 'bold')
      doc.setFontSize(13)
      doc.text(drugName || 'ชื่อยา', COL_X[0] + COL_W / 2, MARGIN + 8, { align: 'center' })
      doc.setFont('Sarabun', 'normal')
      doc.setFontSize(10)
      doc.text(drugGroup, COL_X[0] + COL_W / 2, MARGIN + 16, { align: 'center' })
      doc.text(drugType || 'ใส่ชนิดยา', COL_X[0] + COL_W / 2, MARGIN + 23, { align: 'center' })

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
          doc.setTextColor(150, 150, 150); doc.text('-', x + 4, y + 5); doc.setTextColor(0, 0, 0);
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

      let y1 = BODY_TOP_C1
      y1 = drawSectionHeader(COL_X[0], y1, COL_W, '1. ยานี้คืออะไร'); y1 = drawContent(COL_X[0], y1, COL_W, contents[1], BODY_BOT - 40)
      y1 = drawSectionHeader(COL_X[0], y1, COL_W, '2. ข้อควรรู้ก่อนใช้ยา'); drawContent(COL_X[0], y1, COL_W, contents[2], BODY_BOT)

      let y2 = BODY_TOP
      y2 = drawSectionHeader(COL_X[1], y2, COL_W, '3. วิธีใช้ยา'); y2 = drawContent(COL_X[1], y2, COL_W, contents[3], BODY_BOT - 45)
      y2 = drawSectionHeader(COL_X[1], y2, COL_W, '4. ข้อควรปฏิบัติระหว่างใช้ยา'); drawContent(COL_X[1], y2, COL_W, contents[4], BODY_BOT)

      let y3 = BODY_TOP
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, '5. อันตรายที่อาจเกิดจากยา'); y3 = drawContent(COL_X[2], y3, COL_W, contents[5], BODY_BOT - 60)
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, '6. ควรเก็บยาอย่างไร'); y3 = drawContent(COL_X[2], y3, COL_W, contents[6], BODY_BOT - 35)
      y3 = drawSectionHeader(COL_X[2], y3, COL_W, '7. ลักษณะและส่วนประกอบของยา'); drawContent(COL_X[2], y3, COL_W, contents[7], BODY_BOT - 20)

      const FY = PH - MARGIN - 16
      doc.setDrawColor(200, 0, 0); doc.setLineWidth(0.8); doc.rect(COL_X[2], FY, COL_W, 16)
      doc.setFont('Sarabun', 'bold'); doc.setFontSize(9); doc.setTextColor(200, 0, 0)
      doc.text('เอกสารนี้เป็นข้อมูลโดยย่อ', COL_X[2] + COL_W / 2, FY + 6, { align: 'center' })
      doc.text('หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร', COL_X[2] + COL_W / 2, FY + 12, { align: 'center' })

      doc.save(`ฉลากยา_${drugName || 'Export'}.pdf`)
    } catch (err) { alert('PDF Error: ' + err.message) }
  }

  const renderTextareaSection = (num) => {
    const isBottomTopic = [2, 4, 7].includes(num);
    return (
      <div key={num} className="section-block">
        <div className="section-header-row"><span className="section-title-text">{topics[num]}</span></div>
        <div className="textarea-container">
          <textarea 
            className="editable-textarea" 
            value={contents[num]} 
            onChange={(e) => handleHelperSearch(e.target.value, num)} 
            onBlur={() => setTimeout(() => setSuggestions([]), 250)} 
            placeholder="พิมพ์เพื่อค้นหาประโยคมาตรฐาน..." 
          />
          {activeTopicForSearch === num && suggestions.length > 0 && (
            <div className={`inline-suggestions ${isBottomTopic ? 'pop-up' : 'pop-down'}`}>
              {suggestions.map((s, i) => (
                <div 
                  key={i} 
                  className="suggestion-item" 
                  onMouseDown={(e) => {
                    e.preventDefault(); 
                    selectSuggestion(s.name, num);
                  }}
                >
                  {s.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="editor-page-wrapper sarabun-font">
      <nav className="main-top-nav">
        <div className="nav-container">
          <img src="/image/psu-logo.png" alt="PSU Logo" className="nav-logo" />
          <h1 className="nav-title-eng">Medication Label Project</h1>
          <div className="nav-actions">
            <button className="btn-clear-nav" onClick={handleClearAll}>Clear All</button>
            <button className="btn-export-nav" onClick={handleExportPDF}>Export PDF</button>
            <button className="btn-login-nav">Login</button>
          </div>
        </div>
      </nav>
      <main className="pil-editor-canvas">
        <div className="pil-paper-shadow">
          <section className="pil-column">
            <div className="name-box-editor">
              <input type="text" placeholder="คลิกเพื่อป้อนชื่อยา..." className="input-drug-name" value={drugName} onChange={(e) => setDrugName(e.target.value)} />
              <select className="select-drug-group" value={drugGroup} onChange={(e) => setDrugGroup(e.target.value)}>
                {drugGroups.map((g, i) => <option key={i} value={g}>{g}</option>)}
              </select>
              <input type="text" placeholder="ใส่ชนิดยา..." className="input-drug-type" value={drugType} onChange={(e) => setDrugType(e.target.value)} />
            </div>
            {[1, 2].map(num => renderTextareaSection(num))}
          </section>
          <section className="pil-column">
            {[3, 4].map(num => renderTextareaSection(num))}
          </section>
          <section className="pil-column">
            {[5, 6, 7].map(num => renderTextareaSection(num))}
            <div className="footer-box-editor"><p>เอกสารนี้เป็นข้อมูลโดยย่อ</p><p>หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร</p></div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App