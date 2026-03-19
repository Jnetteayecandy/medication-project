import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { sarabunBase64 } from './thaiFont'


// --- เชื่อมต่อฐานข้อมูล Supabase ---
const supabaseUrl = 'https://bcehtpixbibbpmejsfyn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjZWh0cGl4YmliYnBtZWpzZnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTc2NzUsImV4cCI6MjA4NjM5MzY3NX0.p7aK5ivvCIPGM83JSdTnZoh0d-h0-X6xloAJbTsn2tg'
const supabase = createClient(supabaseUrl, supabaseKey)


function App() {
 const [step, setStep] = useState(0)
 const [drugGroup, setDrugGroup] = useState('')
 const [drugGroups, setDrugGroups] = useState([])   // ← ดึงจาก DB
 const [drugName, setDrugName] = useState('')
 const [helperSearch, setHelperSearch] = useState('')
 const [contents, setContents] = useState(Array(8).fill(''))
 const [suggestions, setSuggestions] = useState([])


 // ── ดึงรายชื่อกลุ่มยาจาก Supabase ตอน mount ──────────────
 useEffect(() => {
   const fetchDrugGroups = async () => {
     const { data, error } = await supabase
       .from('drug_groups')
       .select('name')
       .order('id', { ascending: true })
     if (data && data.length > 0) {
       setDrugGroups(data.map(d => d.name))
       setDrugGroup(data[0].name)   // เลือก default เป็นตัวแรก
     }
   }
   fetchDrugGroups()
 }, [])


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


 // PDF EXPORT — PIL Leaflet 3-column style (landscape A4)

 const handleExportPDF = () => {
   try {
     const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })


     // ลงทะเบียน Sarabun font
     doc.addFileToVFS('Sarabun.ttf', sarabunBase64)
     doc.addFont('Sarabun.ttf', 'Sarabun', 'normal')
     doc.addFont('Sarabun.ttf', 'Sarabun', 'bold')


     const PW = doc.internal.pageSize.getWidth()   // 297 mm
     const PH = doc.internal.pageSize.getHeight()  // 210 mm


     const MARGIN  = 8
     const GAP     = 4
     const COL_W   = (PW - MARGIN * 2 - GAP * 2) / 3
     const COL_X   = [
       MARGIN,
       MARGIN + COL_W + GAP,
       MARGIN + (COL_W + GAP) * 2
     ]


     // กล่องชื่อยา (col1)
     const NAME_BOX_H  = 28
     const NAME_GAP    = 5
     const BODY_TOP_C1 = MARGIN + NAME_BOX_H + NAME_GAP
     const BODY_TOP    = MARGIN
     const BODY_BOT    = PH - MARGIN - 2

     // กล่องชื่อยา
     doc.setDrawColor(0, 0, 0)
     doc.setLineWidth(0.8)
     doc.rect(COL_X[0], MARGIN, COL_W, NAME_BOX_H)


     doc.setFont('Sarabun', 'bold')
     doc.setFontSize(13)
     doc.setTextColor(0, 0, 0)
     doc.text(drugName || 'ชื่อยา', COL_X[0] + COL_W / 2, MARGIN + 8, { align: 'center' })


     doc.setFont('Sarabun', 'normal')
     doc.setFontSize(10)
     doc.text(drugGroup, COL_X[0] + COL_W / 2, MARGIN + 16, { align: 'center' })
     doc.text('ชนิดเม็ดเคลือบฟิล์ม', COL_X[0] + COL_W / 2, MARGIN + 23, { align: 'center' })

     // Helper functions


     // Section header
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


     // เนื้อหา bullet แบบ wrap
     const drawContent = (x, y, w, text, bottomLimit) => {
       if (!text || text.trim() === '') {
         doc.setFont('Sarabun', 'normal')
         doc.setFontSize(9)
         doc.setTextColor(150, 150, 150)
         doc.text('-', x + 4, y + 5)
         doc.setTextColor(0, 0, 0)
         return y + 7
       }
       doc.setFont('Sarabun', 'normal')
       doc.setFontSize(9)
       doc.setTextColor(0, 0, 0)
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


     // col1: หัวข้อ 1, 2
     let y1 = BODY_TOP_C1
     y1 = drawSectionHeader(COL_X[0], y1, COL_W, '1. ยานี้คืออะไร')
     y1 = drawContent(COL_X[0], y1, COL_W, contents[1], BODY_BOT - 40)
     y1 = drawSectionHeader(COL_X[0], y1, COL_W, '2. ข้อควรรู้ก่อนใช้ยา')
     drawContent(COL_X[0], y1, COL_W, contents[2], BODY_BOT)


     // col2: หัวข้อ 3, 4
     let y2 = BODY_TOP
     y2 = drawSectionHeader(COL_X[1], y2, COL_W, '3. วิธีใช้ยา')
     y2 = drawContent(COL_X[1], y2, COL_W, contents[3], BODY_BOT - 45)
     y2 = drawSectionHeader(COL_X[1], y2, COL_W, '4. ข้อควรปฏิบัติระหว่างใช้ยา')
     drawContent(COL_X[1], y2, COL_W, contents[4], BODY_BOT)


     // col3: หัวข้อ 5, 6, 7 + footer กล่องแดง
     const FOOTER_H  = 16  // พื้นที่ footer ใน col3
     const COL3_BOT  = BODY_BOT - FOOTER_H - 2


     let y3 = BODY_TOP
     y3 = drawSectionHeader(COL_X[2], y3, COL_W, '5. อันตรายที่อาจเกิดจากยา')
     y3 = drawContent(COL_X[2], y3, COL_W, contents[5], COL3_BOT - 40)
     y3 = drawSectionHeader(COL_X[2], y3, COL_W, '6. ควรเก็บยาอย่างไร')
     y3 = drawContent(COL_X[2], y3, COL_W, contents[6], COL3_BOT - 18)
     y3 = drawSectionHeader(COL_X[2], y3, COL_W, '7. ลักษณะและส่วนประกอบของยา')
     drawContent(COL_X[2], y3, COL_W, contents[7], COL3_BOT)


     // ─── Footer กล่องแดง — ขวาล่าง col3 ──────────────────
     const FY  = BODY_BOT - FOOTER_H
     const FX  = COL_X[2]
     const FW  = COL_W
     doc.setDrawColor(200, 0, 0)
     doc.setLineWidth(0.8)
     doc.rect(FX, FY, FW, FOOTER_H)


     doc.setFont('Sarabun', 'bold')
     doc.setFontSize(9)
     doc.setTextColor(200, 0, 0)
     doc.text('เอกสารนี้เป็นข้อมูลโดยย่อ', FX + FW / 2, FY + 6,  { align: 'center' })
     doc.text('หากมีข้อสงสัยให้ปรึกษาแพทย์หรือเภสัชกร', FX + FW / 2, FY + 12, { align: 'center' })


     doc.save(`ฉลากยา_${drugName || 'Export'}.pdf`)
     alert('ดาวน์โหลดสำเร็จ! โปรดตรวจสอบที่โฟลเดอร์ Download')


   } catch (err) {
     console.error('PDF Error:', err)
     alert('ไม่สามารถสร้าง PDF ได้: ' + err.message)
   }
 }


 // SUPABASE SEARCH — ปรับแก้เพื่อให้รองรับชื่อคอลัมน์ใหม่

 const handleHelperSearch = async (val) => {
   setHelperSearch(val)
   if (val.length > 1) {
     try {
       // สร้างชื่อคอลัมน์ให้ตรงกับที่มีช่องว่างและตัวพิมพ์ใหญ่ เช่น "PILs Ibuprofen"
       // ต้องใส่เครื่องหมายคำพูดล้อมรอบชื่อคอลัมน์เพื่อให้ SQL ทำงานได้ถูกต้อง
       const targetColumn = `"PILs ${drugName}"`;


       const { data, error } = await supabase
         .from(`topic${step}`)
         .select('name')
         .not(targetColumn, 'is', null) // กรองเฉพาะประโยคที่ใช้กับยานี้
         .ilike('name', `%${val}%`)
         .limit(10)
      
       if (error) throw error
       if (data) setSuggestions(data)
     } catch (err) {
       console.error("Search Error:", err.message)
     }
   } else {
     setSuggestions([])
   }
 }


 const selectSuggestion = (name) => {
   const newContents = [...contents]
   newContents[step] =
     (newContents[step] ? newContents[step].trim() + '\n' : '') + name
   setContents(newContents)
   setSuggestions([])
   setHelperSearch('')
 }


 // ============================================================
 // STEP 0 — เลือกกลุ่มยา
 // ============================================================
 if (step === 0) {
   return (
     <div className="main-container">
       <div className="glass-card shadow-lg">
         <img
           src="https://www.psu.ac.th/phuket/wp-content/uploads/2019/03/cropped-PSU_PHUKET-EN.png"
           alt="PSU Logo"
           className="logo"
         />
         <h2 className="title">Medication Label Project</h2>


         <div className="form-group">
           <label>เลือกกลุ่มยา:</label>
           <select
             className="input-field"
             value={drugGroup}
             onChange={(e) => setDrugGroup(e.target.value)}
           >
             {drugGroups.length === 0 ? (
               <option value="">กำลังโหลด...</option>
             ) : (
               drugGroups.map((g, i) => (
                 <option key={i} value={g}>{g}</option>
               ))
             )}
           </select>
         </div>


         <div className="form-group">
           <label>ป้อนชื่อยา:</label>
           <input
             type="text"
             className="input-field"
             placeholder="เช่น Ibuprofen..."
             value={drugName}
             onChange={(e) => setDrugName(e.target.value)}
           />
         </div>


         <button className="btn-start" onClick={() => setStep(1)}>
           เริ่มทำรายการ
         </button>
       </div>
     </div>
   )
 }

 // MAIN FORM — Steps 1–7
 return (
   <div className="main-container">
     <div className="glass-card shadow-lg" style={{ maxWidth: '1000px', width: '95%' }}>
       <h3 className="topic-title" style={{ textAlign: 'center', marginBottom: '25px' }}>
         {topics[step]}
       </h3>


       <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
         {/* Helper Search */}
         <div style={{ flex: 1, position: 'relative' }}>
           <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '10px' }}>
             ค้นหาประโยคมาตรฐาน (Helper):
           </label>
           <input
             type="text"
             className="input-field helper-input"
             placeholder="พิมพ์เพื่อค้นหา..."
             value={helperSearch}
             onChange={(e) => handleHelperSearch(e.target.value)}
           />
           {suggestions.length > 0 && (
             <div className="suggestion-popup" style={{ position: 'absolute', width: '100%', zIndex: 10 }}>
               {suggestions.map((item, index) => (
                 <div
                   key={index}
                   className="suggestion-item"
                   onClick={() => selectSuggestion(item.name)}
                 >
                   {item.name}
                 </div>
               ))}
             </div>
           )}
           <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '10px' }}>
             * เลือกประโยคทางซ้ายเพื่อเพิ่มลงในช่องเนื้อหาทางขวา
           </p>
         </div>


         {/* Content Textarea */}
         <div style={{ flex: 1.5 }}>
           <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '10px' }}>
             เนื้อหาในหัวข้อนี้:
           </label>
           <textarea
             className="textarea-field"
             style={{ height: '250px', resize: 'none' }}
             value={contents[step]}
             onChange={(e) => {
               const newC = [...contents]
               newC[step] = e.target.value
               setContents(newC)
             }}
             placeholder="รายละเอียดเนื้อหาบนฉลากยา..."
           />
         </div>
       </div>


       {/* Buttons */}
       <div className="button-group" style={{ marginTop: '30px', display: 'flex', justifyContent: 'center', gap: '15px' }}>
         <button className="btn-back" onClick={() => setStep(step - 1)}>
           ย้อนกลับ
         </button>
         {step < 7 ? (
           <button
             className="btn-next"
             onClick={() => {
               setStep(step + 1)
               setHelperSearch('')
               setSuggestions([])
             }}
           >
             ถัดไป
           </button>
         ) : (
           <button className="btn-export" onClick={handleExportPDF}>
             Export PDF
           </button>
         )}
       </div>
     </div>
   </div>
 )
}


export default App
