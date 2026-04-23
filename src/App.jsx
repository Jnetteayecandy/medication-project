import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import jsPDF from 'jspdf'
import { sarabunBase64 } from './thaiFont'
import './App.css'

const supabaseUrl = 'https://bcehtpixbibbpmejsfyn.supabase.co'
const supabaseKey = "sb_publishable_ukt54W7gCdi70e6bSr7jzw_dPxxaTCa"
const supabase = createClient(supabaseUrl, supabaseKey)

function App() {
  // --- 1. Auth State ---
  const [user, setUser] = useState(null)
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginTab, setLoginTab] = useState('signin')

  // --- 2. Project State ---
  const [activeMedId, setActiveMedId] = useState(null) // เก็บ ID ยาที่กำลังแก้ไข
  const [drugGroup, setDrugGroup] = useState('')
  const [drugGroups, setDrugGroups] = useState([])
  const [drugName, setDrugName] = useState('')
  const [drugType, setDrugType] = useState('')
  const [contents, setContents] = useState(Array(8).fill(''))

  // State สำหรับ Smart Search (ค้นหายาเก่า)
  const [medSuggestions, setMedSuggestions] = useState([])
  const [showMedSuggestions, setShowMedSuggestions] = useState(false)

  // State สำหรับ Helper Search (ค้นหาประโยคมาตรฐาน)
  const [activeTopicForSearch, setActiveTopicForSearch] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const searchTimeoutRef = useRef(null)

  // --- 3. Lifecycle & Auth Effects ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (!session?.user) setShowLogin(true) // ถ้าไม่มี user ให้โชว์หน้า login
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (!session?.user) {
        setShowLogin(true) // เมื่อ logout ให้กลับหน้า login
        handleClearAll(true) // ล้างข้อมูลในหน้าจอ (silent)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const fetchDrugGroups = async () => {
      const { data } = await supabase
        .from('drug_groups')
        .select('name')
        .order('id', { ascending: true })

      if (data && data.length > 0) {
        setDrugGroups(data.map(d => d.name))
        setDrugGroup(data[0].name)
      }
    }
    fetchDrugGroups()
  }, [])

  // --- 4. Smart Search Logic (ค้นหายาที่เคยเซฟไว้) ---
  const handleDrugNameChange = async (val) => {
    setDrugName(val)
    setActiveMedId(null) // ถ้าพิมพ์ใหม่ ให้ถือว่าเป็นยาตัวใหม่ไว้ก่อน

    if (val.length >= 2) {
      const { data } = await supabase
        .from('medication_templates')
        .select('*')
        .ilike('med_name', `%${val}%`)
        .limit(5)
      setMedSuggestions(data || [])
      setShowMedSuggestions(true)
    } else {
      setMedSuggestions([])
      setShowMedSuggestions(false)
    }
  }

  const selectMedTemplate = (med) => {
    setActiveMedId(med.id)
    setDrugName(med.med_name)
    setDrugGroup(med.med_group)
    setDrugType(med.med_type)
    setContents(med.contents) // ดึงข้อมูลทั้ง 7 ช่องมาใส่ทันที
    setMedSuggestions([])
    setShowMedSuggestions(false)
  }

  // --- 5. Auth Handlers ---
  const handleLogin = async (e) => {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      alert("Login Error: " + error.message)
    } else {
      setShowLogin(false)
      setEmail('')
      setPassword('')
    }
  }

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) alert("Logout Error: " + error.message)
  }

  // --- 6. Project Actions ---
  const handleClearAll = (silent = false) => {
    // กลับมามี Confirm แล้วครับ
    if (silent || window.confirm("คุณต้องการล้างข้อมูลทั้งหมดใช่หรือไม่?")) {
      setDrugName('')
      setDrugType('')
      setContents(Array(8).fill(''))
      setActiveMedId(null)
      if (drugGroups.length > 0) setDrugGroup(drugGroups[0])
    }
  }

  // ฟังก์ชันเซฟข้อมูล (Upsert)
  const handleSaveTemplate = async () => {
    if (!drugName) return alert("กรุณาใส่ชื่อยาก่อนเซฟ")

    const medData = {
      med_name: drugName,
      med_group: drugGroup,
      med_type: drugType,
      contents: contents,
      last_updated_by: user?.email,
      updated_at: new Date()
    }

    try {
      let result;
      if (activeMedId) {
        // ถ้าเป็นยาเก่าที่มี ID อยู่แล้ว ให้ Update
        result = await supabase
          .from('medication_templates')
          .update(medData)
          .eq('id', activeMedId)
      } else {
        // ถ้าเป็นยาใหม่ ให้ Insert
        result = await supabase
          .from('medication_templates')
          .insert([medData])
          .select()
        if (result.data) setActiveMedId(result.data[0].id)
      }

      if (result.error) throw result.error
      alert("บันทึกข้อมูลสำเร็จแล้ว!")
    } catch (err) {
      alert("Save Error: " + err.message)
    }
  }

  const handleHelperSearch = async (val, topicNum) => {
    const newContents = [...contents]
    newContents[topicNum] = val
    setContents(newContents)
    setActiveTopicForSearch(topicNum)

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    const lines = val.split('\n')
    const lastLine = lines[lines.length - 1].trim()

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
    const lines = currentText.split('\n')
    lines.pop()
    lines.push(suggestionName)
    newContents[topicNum] = lines.join('\n') + '\n'
    setContents(newContents)
    setSuggestions([])
    setActiveTopicForSearch(null)
  }

  const topics = [
    "",
    "1. ยานี้คืออะไร",
    "2. ข้อควรรู้ก่อนใช้ยา",
    "3. วิธีใช้ยา",
    "4. ข้อควรปฏิบัติระหว่างใช้ยา",
    "5. อันตรายที่อาจเกิดจากยา",
    "6. ควรเก็บยาอย่างไร",
    "7. ลักษณะและส่วนประกอบของยา"
  ]

  // --- 7. PDF Export ---
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

      const FY = PH - MARGIN - 16
      doc.setDrawColor(200, 0, 0)
      doc.setLineWidth(0.8)
      doc.rect(COL_X[2], FY, COL_W, 16)
      doc.setFont('Sarabun', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(200, 0, 0)
      doc.text('เอกสารนี้เป็นข้อมูลโดยย่อ', COL_X[2] + COL_W / 2, FY + 6, { align: 'center' })
      doc.text('หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร', COL_X[2] + COL_W / 2, FY + 12, { align: 'center' })
      doc.save(`ฉลากยา_${drugName || 'Export'}.pdf`)
    } catch (err) {
      alert('PDF Error: ' + err.message)
    }
  }

  // --- 8. UI Components ---
  const renderTextareaSection = (num) => {
    const isBottomTopic = [2, 4, 7].includes(num)
    return (
      <div key={num} className="section-block">
        <div className="section-header-row">
          <span className="section-title-text">{topics[num]}</span>
        </div>
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
                    e.preventDefault()
                    selectSuggestion(s.name, num)
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
      {/* --- LOGIN PAGE --- */}
      {showLogin && (
        <div className="login-fullscreen">
          <div className="login-side-blue">
            <div className="med-explorer-header"></div>
            <div className="blue-content-center"></div>
            <div className="glass-capsule-footer">
              <p>© 2026 Gladiator. All rights reserved.</p>
              <p className="tiny-text">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Consectetur officiis nihil vitae modi similique molestiae, est at a, suscipit quas repellendus eos consequuntur blanditiis eveniet tempora doloribus exercitationem illum alias?</p>
            </div>
          </div>
          <div className="login-side-white">
            {user && <button className="back-btn" onClick={() => setShowLogin(false)}>✕</button>}
            <div className="login-card">
              <div className="login-tabs">
                <button
                  className={`tab-btn ${loginTab === 'signin' ? 'active' : ''}`}
                  onClick={() => setLoginTab('signin')}
                >
                  Sign in
                </button>
                <button
                  className={`tab-btn ${loginTab === 'signup' ? 'active' : ''}`}
                  onClick={() => setLoginTab('signup')}
                >
                  Sign Up
                </button>
              </div>
              {loginTab === 'signin' ? (
                <>
                  <h1>Welcome!</h1>
                  <form onSubmit={handleLogin}>
                    <div className="input-group">
                      <input
                        type="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="input-group">
                      <input
                        type="password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>

                    {/* --- เพิ่มส่วน Remember me และ Forgot Password ตรงนี้ --- */}
                    <div className="login-options">
                      <label>
                        <input type="checkbox" /> Remember me
                      </label>
                      <a href="#">Forgot Password?</a>
                    </div>
                    {/* -------------------------------------------------- */}

                    <button type="submit" className="btn-main-login">Login</button>
                  </form>
                </>
              ) : (
                <>
                  <h1>Create Account</h1>
                  <p>Contact admin to register a new pharmacist account.</p>
                </>
              )}
              <div className="supported-by">
                <p>Supported by</p>
                <img src="/image/psu-logo.png" alt="PSU Logo" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MAIN NAVIGATION --- */}
      <nav className="main-top-nav">
  <div className="nav-container">
    <div className="nav-left-area">
      <img src="/image/psu-logo.png" alt="PSU Logo" className="nav-logo" />
      {user && <span className="user-email-label">{user.email}</span>}
    </div>
    <div className="nav-center-area">
      <h1 className="nav-title-eng">Medication Label</h1>
    </div>

    <div className="nav-right-area">
      <button className="btn-save-nav" onClick={handleSaveTemplate}>Save Template</button>
      <button className="btn-clear-nav" onClick={handleClearAll}>Clear All</button>
      <button className="btn-export-nav" onClick={handleExportPDF}>Export PDF</button>
      <button className="btn-login-nav logout" onClick={handleLogout}>Logout</button>
    </div>

  </div>
</nav>

      {/* --- EDITOR CANVAS --- */}
      <main className="pil-editor-canvas">
        <div className="pil-paper-shadow">
          <section className="pil-column">
            <div className="name-box-editor">
              <div className="search-container">
                <input
                  type="text"
                  placeholder="ค้นหาหรือป้อนชื่อยา..."
                  className="input-drug-name"
                  value={drugName}
                  onChange={(e) => handleDrugNameChange(e.target.value)}
                />
                {showMedSuggestions && medSuggestions.length > 0 && (
                  <div className="med-suggestions">
                    {medSuggestions.map((m) => (
                      <div key={m.id} className="med-suggestion-item" onClick={() => selectMedTemplate(m)}>
                        <div className="med-suggest-name">{m.med_name}</div>
                        <div className="med-suggest-type">{m.med_type || 'ไม่ระบุชนิด'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <select className="select-drug-group" value={drugGroup} onChange={(e) => setDrugGroup(e.target.value)}>
                {drugGroups.map((g, i) => <option key={i} value={g}>{g}</option>)}
              </select>
              <input
                type="text"
                placeholder="ใส่ชนิดยา..."
                className="input-drug-type"
                value={drugType}
                onChange={(e) => setDrugType(e.target.value)}
              />
            </div>
            {[1, 2].map(num => renderTextareaSection(num))}
          </section>
          <section className="pil-column">{[3, 4].map(num => renderTextareaSection(num))}</section>
          <section className="pil-column">
            {[5, 6, 7].map(num => renderTextareaSection(num))}
            <div className="footer-box-editor">
              <p>เอกสารนี้เป็นข้อมูลโดยย่อ หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App