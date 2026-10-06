import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import './App.css'
import { useAuth, ROLES } from './context/AuthContext'
import {
  canCreateLabel,
  canEditLabel,
  canDeleteLabel,
  canAccessMedicineCategory,
  canManageSystemTopics,
  isLabelOwner,
  getPermissionDenialReason
} from './utils/permissions'
import {
  generateQRCodeDataURL,
  generateQRCodeSVG,
  generateAndDistributeQRCode,
  downloadQRCodeFile,
  printPackagingSticker
} from './utils/qrGenerator'
import {
  generateMedicationPdfDoc,
  generateMedicationPdfBlob,
  getDirectPdfUrl,
  PIL_TOPIC_NAMES
} from './utils/pdfGenerator'
import DedicatedPdfView from './components/DedicatedPdfView'

// Initial default manage data matching mockup
const DEFAULT_MANAGE_DATA = {
  footer: {
    footer_statements: [
      { id: 'fs_1', text: 'บริษัท ไบโอลิค (ประเทศไทย) จำกัด' },
      { id: 'fs_2', text: 'บริษัท เจริญเภสัชแล็บ จำกัด' },
      { id: 'fs_3', text: 'Store below 30°C in a dry place, protect from direct sunlight.' },
      { id: 'fs_4', text: 'This leaflet was last revised in October 2024.' }
    ],
    manufacturer: [
      { id: 'mf_1', text: 'Biolab (Thailand) Co., Ltd.' },
      { id: 'mf_2', text: 'Charoen Bhaesaj Lab Co., Ltd.' },
      { id: 'mf_3', text: 'The Government Pharmaceutical Organization (GPO)' },
      { id: 'mf_4', text: 'Siam Bheasach Co., Ltd.' }
    ],
    distributor: [
      { id: 'db_1', text: 'DKSH (Thailand) Limited' },
      { id: 'db_2', text: 'Zuellig Pharma Ltd.' },
      { id: 'db_3', text: 'Diethelm Keller SiberHegner' }
    ],
    revision_date: [
      { id: 'rd_1', text: 'Revised Date: October 2024' },
      { id: 'rd_2', text: 'Revised Date: January 2025' },
      { id: 'rd_3', text: 'Revised Date: March 2025' }
    ],
    additional_info: [
      { id: 'ai_1', text: 'Keep out of reach of children.' },
      { id: 'ai_2', text: 'Do not use after the expiry date stated on the carton.' },
      { id: 'ai_3', text: 'Medicines should not be disposed of via wastewater or household waste.' }
    ]
  },
  topics: {
    topic1: [
      { id: 't1_1', text: 'Film-coated tablets containing 500mg Paracetamol' },
      { id: 't1_2', text: 'Used for the relief of mild to moderate pain and to reduce fever' }
    ],
    topic2: [
      { id: 't2_1', text: 'Do not take if you are allergic to paracetamol or any of the ingredients' },
      { id: 't2_2', text: 'Consult your doctor before use if you have severe kidney or liver impairment' }
    ],
    topic3: [
      { id: 't3_1', text: 'Adults: Take 1-2 tablets every 4 to 6 hours as needed (Maximum 4000mg/day)' },
      { id: 't3_2', text: 'Children 6-12 years: Take half to 1 tablet every 4 to 6 hours' }
    ],
    topic4: [
      { id: 't4_1', text: 'Do not take other medicines containing paracetamol concurrently' },
      { id: 't4_2', text: 'Avoid alcohol consumption while taking this medication' }
    ],
    topic5: [
      { id: 't5_1', text: 'Stop taking immediately and seek medical care if skin rash or swelling occurs' },
      { id: 't5_2', text: 'Prolonged or excessive use may lead to severe liver damage' }
    ],
    topic6: [
      { id: 't6_1', text: 'Store below 30°C in a dry place, protected from direct sunlight' },
      { id: 't6_2', text: 'Keep out of the sight and reach of children' }
    ],
    topic7: [
      { id: 't7_1', text: 'White, circular, biconvex tablets scored on one side' },
      { id: 't7_2', text: 'Active substance: Paracetamol 500 mg. Excipients: Starch, Povidone, Stearic acid' }
    ]
  }
}

const FOOTER_CATEGORIES = [
  { id: 'manufacturer', label: 'Manufacturer', hasIcon: true },
  { id: 'distributor', label: 'Distributor' },
  { id: 'revision_date', label: 'Revision Date' },
  { id: 'additional_info', label: 'Additional Info' },
  { id: 'footer_statements', label: 'Footer Statements' }
]

const TOPIC_CATEGORIES = [
  { id: 'topic1', label: '1. What Is This Medicine' },
  { id: 'topic2', label: '2. Before Taking This Medicine' },
  { id: 'topic3', label: '3. How to Take This Medicine' },
  { id: 'topic4', label: '4. Precautions While Taking' },
  { id: 'topic5', label: '5. Possible Side Effects' },
  { id: 'topic6', label: '6. How to Store This Medicine' },
  { id: 'topic7', label: '7. Appearance & Ingredients' }
]

const TOPIC_SUB_OPTIONS = {
  topic1: [
    { value: '111', label: '111 - ข้อมูลระบุตัวยา/กลุ่มยา' },
    { value: '112', label: '112 - กลุ่มยาต้านอักเสบ' },
    { value: '12', label: '12 - ข้อบ่งใช้/สรรพคุณ' }
  ],
  topic2: [
    { value: '21', label: '21 - ข้อห้ามใช้เด็ดขาด' },
    { value: '22', label: '22 - ข้อควรระวังก่อนใช้ยา' }
  ],
  topic3: [
    { value: '31', label: '31 - วิธีรับประทาน/ขนาดยา' },
    { value: '32', label: '32 - กรณีลืมรับประทานยา' },
    { value: '33', label: '33 - สังเกตอาการผิดปกติรุนแรง' }
  ],
  topic4: [], // ไม่มี sub_topic
  topic5: [
    { value: '51', label: '51 - ผลข้างเคียงรุนแรงที่ต้องพบแพทย์ทันที' },
    { value: '52', label: '52 - ผลข้างเคียงทั่วไปที่ไม่รุนแรง' }
  ],
  topic6: [], // ไม่มี sub_topic
  topic7: []  // ไม่มี sub_topic
}

const CATEGORY_META = {
  footer_statements: {
    title: 'Footer Statements',
    subtitle: 'Add or edit your document footer statement entries',
    placeholder: 'Footer statement'
  },
  manufacturer: {
    title: 'Manufacturer',
    subtitle: 'Add or edit pharmaceutical manufacturer entries',
    placeholder: 'Manufacturer name'
  },
  distributor: {
    title: 'Distributor',
    subtitle: 'Add or edit medication distributor entries',
    placeholder: 'Distributor name'
  },
  revision_date: {
    title: 'Revision Date',
    subtitle: 'Add or edit standard document revision dates',
    placeholder: 'Revision date'
  },
  additional_info: {
    title: 'Additional Info',
    subtitle: 'Add or edit additional warnings or disposal notes',
    placeholder: 'Additional info note'
  },
  topic1: {
    title: '1. What Is This Medicine',
    subtitle: 'Standard reusable phrases for drug identity and indication',
    placeholder: 'Drug identity phrase'
  },
  topic2: {
    title: '2. Before Taking This Medicine',
    subtitle: 'Standard reusable phrases for contraindications and warnings before use',
    placeholder: 'Pre-use warning phrase'
  },
  topic3: {
    title: '3. How to Take This Medicine',
    subtitle: 'Standard reusable phrases for dosage and administration',
    placeholder: 'Dosage instruction'
  },
  topic4: {
    title: '4. Precautions While Taking',
    subtitle: 'Standard reusable phrases for precautions and warnings during use',
    placeholder: 'Precaution note'
  },
  topic5: {
    title: '5. Possible Side Effects',
    subtitle: 'Standard reusable phrases for adverse reactions and hazards',
    placeholder: 'Side effect description'
  },
  topic6: {
    title: '6. How to Store This Medicine',
    subtitle: 'Standard reusable phrases for proper storage conditions',
    placeholder: 'Storage instruction'
  },
  topic7: {
    title: '7. Appearance & Ingredients',
    subtitle: 'Standard reusable phrases for drug appearance and composition',
    placeholder: 'Appearance or ingredient'
  }
}

// Clean vector icon renderer for user avatars without emojis
function renderUserAvatarIcon(user) {
  if (!user) return null

  // Admin: Clean vector crown
  if (user.role === ROLES.ADMIN) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
      </svg>
    )
  }

  // Pharmacist: Clean vector medical pill / capsule line-art
  if (user.role === ROLES.PHARMACIST) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
        <path d="m8.5 8.5 7 7" />
      </svg>
    )
  }

  // Staff: Clean vector user silhouette
  if (user.role === ROLES.STAFF) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  }

  // Guest: Clean vector user icon
  if (user.role === ROLES.GUEST || user.isGuest) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  }

  const initial = user.name ? user.name.charAt(0).toUpperCase() : (user.role ? user.role.charAt(0) : 'U')
  return <span style={{ fontWeight: 700, fontSize: '13px' }}>{initial}</span>
}

const AVATAR_COLORS_MAP = {
  F: '#8b5cf6', // purple (Fexofenadine)
  I: '#4f46e5', // blue/indigo (Ibuprofen)
  C: '#ec4899', // pink (Cetirizine)
  N: '#0d9488', // teal (Naproxen)
  A: '#f59e0b', // amber
  P: '#2563eb', // blue
  B: '#06b6d4', // cyan
  D: '#10b981', // emerald
  M: '#6366f1', // indigo
}

const FALLBACK_PALETTE = ['#8b5cf6', '#4f46e5', '#ec4899', '#0d9488', '#2563eb', '#f59e0b', '#10b981', '#06b6d4']

function getMedAvatarBg(name, index = 0) {
  if (!name) return '#2563eb'
  const char = name.trim().charAt(0).toUpperCase()
  if (AVATAR_COLORS_MAP[char]) return AVATAR_COLORS_MAP[char]
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
}

function App() {
  // --- 0. Authentication & Authorization Context ---
  const {
    currentUser,
    loading: authLoading,
    login,
    loginAsGuest,
    logout
  } = useAuth()

  // --- 1. Auth State ---
  const [showLogin, setShowLogin] = useState(false)
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginTab, setLoginTab] = useState('signin')

  // --- 2. Navigation State ---
  const [currentView, setCurrentView] = useState('dashboard') // 'dashboard' | 'editor' | 'manage_data'
  const [activeModal, setActiveModal] = useState(null) // null | 'import_word' | 'join_code'
  const [joinCode, setJoinCode] = useState('')

  // --- Manage Data State ---
  const [manageMainTab, setManageMainTab] = useState('topics') // 'topics' | 'footer' | 'drug_data'
  const [manageSubCategory, setManageSubCategory] = useState('topic1')
  const [selectedSubTopic, setSelectedSubTopic] = useState('')
  const [manageSearchQuery, setManageSearchQuery] = useState('')
  const [manageNewItemInput, setManageNewItemInput] = useState('')
  const [manageEditingId, setManageEditingId] = useState(null)
  const [manageEditingText, setManageEditingText] = useState('')
  const [savedDrugsList, setSavedDrugsList] = useState([])
  const [supabaseTopicsData, setSupabaseTopicsData] = useState({})
  const [isLoadingTopic, setIsLoadingTopic] = useState(false)
  const [topicSaveStatus, setTopicSaveStatus] = useState(null) // { id: number, status: 'saving' | 'saved' | 'error' }
  const [manageData, setManageData] = useState(() => {
    try {
      const saved = localStorage.getItem('pil_managed_data_v2')
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    return DEFAULT_MANAGE_DATA
  })

  // Sync manageData to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pil_managed_data_v2', JSON.stringify(manageData))
    } catch {
      // ignore
    }
  }, [manageData])

  // --- 3. Project State ---
  const [activeMedId, setActiveMedId] = useState(null) // เก็บ ID ยาที่กำลังแก้ไข
  const [activeMedDetails, setActiveMedDetails] = useState(null) // เก็บ Object ข้อมูลยาที่กำลังแก้ไขสำหรับตรวจ Ownership
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

  // --- QR Code Distribution State ---
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrModalMed, setQrModalMed] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrSvgString, setQrSvgString] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)
  const [qrRegenSuccess, setQrRegenSuccess] = useState(false)

  // --- Dedicated Fullscreen / Mobile PDF View State ---
  const [isPdfViewMode, setIsPdfViewMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const path = window.location.pathname
    const search = new URLSearchParams(window.location.search)
    return path.startsWith('/view-pdf') || search.has('med') || search.has('pdf')
  })
  const [pdfViewDrug, setPdfViewDrug] = useState(null)
  const [pdfViewLoading, setPdfViewLoading] = useState(false)
  const [pdfViewError, setPdfViewError] = useState(null)

  // --- Direct PDF Download / Stream State (Zero-UI mode for QR scanning) ---
  const [isDirectPdfMode, setIsDirectPdfMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const path = window.location.pathname
    const search = new URLSearchParams(window.location.search)
    return path.startsWith('/download-pdf') || search.has('download_pdf')
  })
  const [directPdfLoading, setDirectPdfLoading] = useState(false)
  const [directPdfError, setDirectPdfError] = useState(null)

  // --- 4. Lifecycle & Auth Effects ---
  useEffect(() => {
    if (!authLoading) {
      if (
        isDirectPdfMode ||
        window.location.pathname.startsWith('/download-pdf') ||
        isPdfViewMode ||
        window.location.pathname.startsWith('/view-pdf')
      ) {
        setShowLogin(false)
        return
      }
      if (!currentUser) {
        setShowLogin(true)
      } else {
        setShowLogin(false)
      }
    }
  }, [currentUser, authLoading, isPdfViewMode, isDirectPdfMode])

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

  // Dedicated Route Detection for QR Code Scanners (/view-pdf/:id, ?med=<id>, ?pdf=<id>)
  useEffect(() => {
    const checkPdfRoute = async () => {
      const pathname = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)

      let targetMedId = null
      if (pathname.startsWith('/view-pdf')) {
        const segments = pathname.replace(/^\/view-pdf\/?/, '').split('/')
        if (segments[0]) targetMedId = decodeURIComponent(segments[0].split('?')[0])
      }
      if (!targetMedId) {
        targetMedId = searchParams.get('med') || searchParams.get('pdf')
      }

      if (targetMedId) {
        setIsPdfViewMode(true)
        setShowLogin(false)
        setPdfViewLoading(true)
        setPdfViewError(null)

        try {
          const { data, error } = await supabase
            .from('medication_templates')
            .select('*')
            .eq('id', targetMedId)
            .maybeSingle()

          if (error) throw error
          if (!data) {
            setPdfViewError('ไม่พบเอกสารฉลากยานี้ในระบบฐานข้อมูล')
          } else {
            setPdfViewDrug(data)
          }
        } catch (err) {
          console.error('Fetch PDF view error:', err)
          setPdfViewError(err.message || 'เกิดข้อผิดพลาดในการโหลดเอกสาร')
        } finally {
          setPdfViewLoading(false)
        }
      }
    }

    checkPdfRoute()

    const handlePopState = () => {
      const pathname = window.location.pathname
      if (!pathname.startsWith('/view-pdf') && !window.location.search.includes('med=') && !window.location.search.includes('pdf=')) {
        setIsPdfViewMode(false)
        setPdfViewDrug(null)
      } else {
        checkPdfRoute()
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Direct PDF Route Detection for instant download/view (/download-pdf/:id, ?download_pdf=<id>)
  useEffect(() => {
    const checkDirectPdfRoute = async () => {
      const pathname = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)

      let targetMedId = null
      if (pathname.startsWith('/download-pdf')) {
        const segments = pathname.replace(/^\/download-pdf\/?/, '').split('/')
        if (segments[0]) targetMedId = decodeURIComponent(segments[0].split('?')[0])
      }
      if (!targetMedId) {
        targetMedId = searchParams.get('download_pdf')
      }

      if (targetMedId) {
        setIsDirectPdfMode(true)
        setShowLogin(false)
        setDirectPdfLoading(true)
        setDirectPdfError(null)

        try {
          const { data, error } = await supabase
            .from('medication_templates')
            .select('*')
            .eq('id', targetMedId)
            .maybeSingle()

          if (error) throw error
          if (!data) {
            setDirectPdfError('ไม่พบเอกสารฉลากยานี้ในระบบฐานข้อมูล')
            return
          }

          // If medication already has a Supabase Storage direct .pdf URL, redirect to it immediately!
          if (data.qr_code_url && data.qr_code_url.startsWith('http') && data.qr_code_url.includes('.pdf')) {
            window.location.replace(data.qr_code_url)
            return
          }

          // Otherwise generate PDF in browser memory and trigger instant view / download
          const pdfBlob = generateMedicationPdfBlob(data, PIL_TOPIC_NAMES)
          const blobUrl = URL.createObjectURL(pdfBlob)

          const cleanName = (data.med_name || 'เอกสารฉลากยา').replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '_')
          const link = document.createElement('a')
          link.href = blobUrl
          link.download = `ฉลากยา_${cleanName}.pdf`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          setTimeout(() => {
            try {
              window.location.replace(blobUrl)
            } catch {
              // Ignore if browser restricts blob redirection
            }
          }, 300)
        } catch (err) {
          console.error('Direct PDF error:', err)
          setDirectPdfError(err.message || 'เกิดข้อผิดพลาดในการโหลดไฟล์ PDF')
        } finally {
          setDirectPdfLoading(false)
        }
      }
    }

    checkDirectPdfRoute()

    const handlePopState = () => {
      const pathname = window.location.pathname
      if (!pathname.startsWith('/download-pdf') && !window.location.search.includes('download_pdf=')) {
        setIsDirectPdfMode(false)
      } else {
        checkDirectPdfRoute()
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleBackFromPdfView = () => {
    setIsPdfViewMode(false)
    setPdfViewDrug(null)
    setPdfViewError(null)
    window.history.pushState({}, '', '/')
    if (!currentUser) {
      loginAsGuest()
    }
    setCurrentView('dashboard')
  }


  // --- 4. Smart Search Logic (ค้นหายาที่เคยเซฟไว้) ---
  const handleDrugNameChange = async (val) => {
    setDrugName(val)
    setActiveMedId(null) // ถ้าพิมพ์ใหม่ ให้ถือว่าเป็นยาตัวใหม่ไว้ก่อน
    setActiveMedDetails(null)

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
    setActiveMedDetails(med)
    setDrugName(med.med_name)
    setDrugGroup(med.med_group)
    setDrugType(med.med_type)
    setContents(med.contents || Array(8).fill(''))
    setMedSuggestions([])
    setShowMedSuggestions(false)
  }

  // --- 5. Auth Handlers ---
  const handleLogin = async (e) => {
    e.preventDefault()
    if (loginSubmitting) return
    setLoginSubmitting(true)
    try {
      await login(email, password)
      setShowLogin(false)
      setCurrentView('dashboard')
      setEmail('')
      setPassword('')
    } catch (error) {
      alert("Login Error: " + (error.message || error))
    } finally {
      setLoginSubmitting(false)
    }
  }

  const handleContinueAsGuest = () => {
    loginAsGuest()
    setShowLogin(false)
    setCurrentView('dashboard')
  }

  const handleLogout = async () => {
    try {
      await logout()
    } catch (err) {
      console.warn("Logout error:", err)
    }
    setShowLogin(true)
    setCurrentView('dashboard')
    handleClearAll(null, true)
  }

  // --- 6. Navigation Actions ---
  const handleStartNewDoc = () => {
    handleClearAll(null, true) // เคลียร์ฟอร์มเตรียมพร้อมสำหรับเอกสารใหม่
    setCurrentView('editor')
  }

  const handleBackToDashboard = () => {
    if (currentUser?.isGuest) {
      setCurrentView('manage_data')
    } else {
      setCurrentView('dashboard')
    }
  }

  // --- Manage Data Handlers ---
  const fetchAllSavedDrugs = async () => {
    try {
      const { data, error } = await supabase
        .from('medication_templates')
        .select('*')
        .order('updated_at', { ascending: false })
      if (error) {
        console.error('Fetch templates error:', error)
      } else if (data) {
        const enriched = data.map((d) => ({
          ...d,
          created_by: d.created_by || null,
          created_by_name: d.created_by_name || (d.last_updated_by || null),
          created_by_role: d.created_by_role || null
        }))
        setSavedDrugsList(enriched)
      }
    } catch (err) {
      console.error('Fetch templates error:', err)
    }
  }

  // --- Supabase Live Topics Operations (topic1 - topic7) ---
  const fetchSupabaseTopic = async (topicTable, force = false) => {
    if (!topicTable || !topicTable.startsWith('topic')) return
    if (!force && supabaseTopicsData[topicTable]) return // use cached if available

    setIsLoadingTopic(true)
    try {
      const { data, error } = await supabase
        .from(topicTable)
        .select('*')
        .order('id', { ascending: true })

      if (error) throw error
      setSupabaseTopicsData(prev => ({
        ...prev,
        [topicTable]: data || []
      }))
    } catch (err) {
      console.error(`Error fetching ${topicTable}:`, err)
    } finally {
      setIsLoadingTopic(false)
    }
  }

  const handleSaveTopicEdit = async (topicTable, id, newName) => {
    if (currentUser?.isGuest) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nผู้เยี่ยมชม (Guest) ไม่สามารถแก้ไขข้อมูลได้')
      return
    }
    if (!newName.trim()) {
      alert('Content cannot be empty.')
      return
    }
    setTopicSaveStatus({ id, status: 'saving' })
    try {
      const { error } = await supabase
        .from(topicTable)
        .update({ name: newName.trim() })
        .eq('id', id)

      if (error) throw error

      setSupabaseTopicsData(prev => ({
        ...prev,
        [topicTable]: (prev[topicTable] || []).map(item =>
          item.id === id ? { ...item, name: newName.trim() } : item
        )
      }))

      setTopicSaveStatus({ id, status: 'saved' })
      setTimeout(() => {
        setTopicSaveStatus(null)
        setManageEditingId(null)
        setManageEditingText('')
      }, 500)
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to update in database: ' + err.message)
      setTopicSaveStatus(null)
    }
  }

  const handleAddTopicItem = async (topicTable, name) => {
    if (currentUser?.isGuest) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nผู้เยี่ยมชม (Guest) ไม่สามารถเพิ่มข้อมูลได้')
      return
    }

    const inputValue = (name !== undefined ? name : manageNewItemInput || '').trim()
    if (!inputValue) {
      alert('กรุณากรอกข้อความก่อนกดเพิ่มข้อมูล (Please enter text before adding)')
      return
    }

    let currentTopicTable = topicTable || manageSubCategory || 'topic1'
    if (typeof currentTopicTable === 'number' || /^[1-7]$/.test(String(currentTopicTable))) {
      currentTopicTable = `topic${currentTopicTable}`
    } else if (!String(currentTopicTable).startsWith('topic')) {
      currentTopicTable = 'topic1'
    }

    setIsLoadingTopic(true)
    try {
      const currentOptions = TOPIC_SUB_OPTIONS[currentTopicTable] || []
      const subTopicValue = currentOptions.length > 0 ? (selectedSubTopic || currentOptions[0].value) : null

      const payload = {
        name: inputValue,
        sub_topic: subTopicValue
      }

      let insertedRow = null
      const { data, error: insertError } = await supabase
        .from(currentTopicTable)
        .insert([payload])
        .select()

      if (insertError) {
        // Fallback กรณีตารางนั้นไม่มีคอลัมน์ sub_topic ใน Supabase
        if (insertError.message?.toLowerCase().includes('sub_topic') || insertError.code === '42703') {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from(currentTopicTable)
            .insert([{ name: inputValue }])
            .select()
          if (fallbackError) throw fallbackError
          if (fallbackData && fallbackData.length > 0) insertedRow = fallbackData[0]
        } else {
          throw insertError
        }
      } else if (data && data.length > 0) {
        insertedRow = data[0]
      }

      // ล้างช่องกรอกข้อความ
      setManageNewItemInput('')

      // อัปเดตข้อมูลเข้า UI ทันที
      if (insertedRow) {
        setSupabaseTopicsData(prev => ({
          ...prev,
          [currentTopicTable]: [...(prev[currentTopicTable] || []), insertedRow]
        }))
      }

      // ดึงข้อมูลล่าสุดยืนยันกับ Supabase
      const { data: refreshedData } = await supabase
        .from(currentTopicTable)
        .select('*')
        .order('id', { ascending: true })

      if (refreshedData) {
        setSupabaseTopicsData(prev => ({
          ...prev,
          [currentTopicTable]: refreshedData
        }))
      }
    } catch (err) {
      console.error(`Failed to add item to ${currentTopicTable}:`, err)
      alert(`ไม่สามารถบันทึกข้อมูลลงตาราง ${currentTopicTable} ได้:\n${err.message || err}`)
    } finally {
      setIsLoadingTopic(false)
    }
  }

  const handleDeleteTopicItem = async (topicTable, id, name) => {
    if (currentUser?.isGuest) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nผู้เยี่ยมชม (Guest) ไม่สามารถลบข้อมูลได้')
      return
    }
    if (!window.confirm(`Are you sure you want to delete this item from ${topicTable}?\n"${name.slice(0, 80)}${name.length > 80 ? '...' : ''}"`)) return
    try {
      const { error } = await supabase
        .from(topicTable)
        .delete()
        .eq('id', id)

      if (error) throw error

      setSupabaseTopicsData(prev => ({
        ...prev,
        [topicTable]: (prev[topicTable] || []).filter(item => item.id !== id)
      }))
    } catch (err) {
      console.error('Delete error:', err)
      alert('Failed to delete item from database: ' + err.message)
    }
  }

  // Effect to automatically fetch topics or medication templates when in Manage Data
  useEffect(() => {
    if (currentView === 'manage_data') {
      if (manageMainTab === 'topics') {
        fetchSupabaseTopic(manageSubCategory)
      } else if (manageMainTab === 'drug_data') {
        fetchAllSavedDrugs()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, manageMainTab, manageSubCategory])

  useEffect(() => {
    if (manageMainTab === 'topics') {
      const options = TOPIC_SUB_OPTIONS[manageSubCategory] || []
      setSelectedSubTopic(options.length > 0 ? options[0].value : '')
    }
  }, [manageSubCategory, manageMainTab])

  // Initial load of drug templates on mount so search and counts are immediately ready
  useEffect(() => {
    fetchAllSavedDrugs()
  }, [])

  const handleAddManageItem = () => {
    if (!canManageSystemTopics(currentUser)) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nเฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถเพิ่มข้อมูลระบบได้')
      return
    }
    if (!manageNewItemInput.trim()) return
    const newItem = {
      id: 'item_' + Date.now(),
      text: manageNewItemInput.trim()
    }
    setManageData(prev => {
      const currentTab = prev[manageMainTab] || {}
      const currentList = currentTab[manageSubCategory] || []
      return {
        ...prev,
        [manageMainTab]: {
          ...currentTab,
          [manageSubCategory]: [newItem, ...currentList]
        }
      }
    })
    setManageNewItemInput('')
  }

  const handleDeleteManageItem = (id) => {
    if (!canManageSystemTopics(currentUser)) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nเฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลระบบได้')
      return
    }
    if (!window.confirm('Are you sure you want to delete this item?')) return
    setManageData(prev => {
      const currentTab = prev[manageMainTab] || {}
      const currentList = currentTab[manageSubCategory] || []
      return {
        ...prev,
        [manageMainTab]: {
          ...currentTab,
          [manageSubCategory]: currentList.filter(item => item.id !== id)
        }
      }
    })
  }

  const handleStartEditItem = (item) => {
    if (!canManageSystemTopics(currentUser)) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nเฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลระบบได้')
      return
    }
    setManageEditingId(item.id)
    setManageEditingText(item.text)
  }

  const handleSaveEditItem = (id) => {
    if (!canManageSystemTopics(currentUser)) {
      alert('Access Denied (สิทธิ์ไม่เพียงพอ):\nเฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลระบบได้')
      return
    }
    if (!manageEditingText.trim()) return
    setManageData(prev => {
      const currentTab = prev[manageMainTab] || {}
      const currentList = currentTab[manageSubCategory] || []
      return {
        ...prev,
        [manageMainTab]: {
          ...currentTab,
          [manageSubCategory]: currentList.map(item => item.id === id ? { ...item, text: manageEditingText.trim() } : item)
        }
      }
    })
    setManageEditingId(null)
    setManageEditingText('')
  }

  const handleCancelEditItem = () => {
    setManageEditingId(null)
    setManageEditingText('')
  }

  const handleDeleteSavedDrug = async (id, name) => {
    const drugToDelete = savedDrugsList.find(d => d.id === id)
    if (!canDeleteLabel(currentUser, drugToDelete)) {
      const denial = getPermissionDenialReason(currentUser, 'delete', drugToDelete)
      alert(`Access Denied (สิทธิ์ไม่เพียงพอ):\n${denial.th}`)
      return
    }
    if (!window.confirm(`Are you sure you want to delete "${name}" from the database?`)) return
    try {
      const { error } = await supabase
        .from('medication_templates')
        .delete()
        .eq('id', id)
      if (error) throw error
      setSavedDrugsList(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      alert('Error deleting medication: ' + err.message)
    }
  }

  const getItemAvatarChar = (text) => {
    if (!text) return 'U'
    const trimmed = text.trim()
    return trimmed.charAt(0) || 'U'
  }

  // --- 7. Project Actions ---
  const handleClearAll = (e, silent = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!silent) {
      const confirmClear = window.confirm("คุณต้องการล้างข้อมูลยาทั้งหมดใช่หรือไม่?\n(ข้อมูลที่ยังไม่ได้บันทึกจะหายไป)");
      if (!confirmClear) return;
    }
    setDrugName('');
    setDrugType('');
    setContents(Array(8).fill(''));
    setActiveMedId(null);
    setActiveMedDetails(null);
    if (drugGroups.length > 0) setDrugGroup(drugGroups[0]);
  };

  // ฟังก์ชันเซฟข้อมูล (Upsert with RBAC & Resource Ownership)
  const handleSaveTemplate = async () => {
    if (!drugName) return alert("กรุณาใส่ชื่อยาก่อนเซฟ")

    // Security Gate: Check Permissions
    if (activeMedId) {
      if (!canEditLabel(currentUser, activeMedDetails)) {
        const denial = getPermissionDenialReason(currentUser, 'edit', activeMedDetails)
        alert(`Access Denied (สิทธิ์ไม่เพียงพอ):\n${denial.th}`)
        return
      }
    } else {
      if (!canCreateLabel(currentUser)) {
        const denial = getPermissionDenialReason(currentUser, 'create')
        alert(`Access Denied (สิทธิ์ไม่เพียงพอ):\n${denial.th}`)
        return
      }
      if (currentUser?.role === ROLES.PHARMACIST && !canAccessMedicineCategory(currentUser, drugGroup)) {
        alert(`Access Denied (สิทธิ์ไม่เพียงพอ):\nเภสัชกรไม่มีสิทธิ์สร้างยาในหมวด "${drugGroup}" (อนุญาตเฉพาะ: ${currentUser?.allowedCategories?.join(', ') || 'ไม่มี'})`)
        return
      }
    }

    const medData = {
      med_name: drugName,
      med_group: drugGroup,
      med_type: drugType,
      contents: contents,
      last_updated_by: currentUser?.name || currentUser?.email || 'User',
      last_updated_by_role: currentUser?.role || 'STAFF',
      updated_at: new Date()
    }

    // Attach creator ownership metadata if new
    if (!activeMedId && currentUser) {
      medData.created_by = currentUser.id
      medData.created_by_name = currentUser.name
      medData.created_by_role = currentUser.role
    }

    try {
      let result;
      let targetMedId = activeMedId;

      if (activeMedId) {
        // Pre-generate / update QR code URL and upload PDF
        try {
          const qrInfo = await generateAndDistributeQRCode({ ...medData, id: activeMedId })
          medData.qr_code_url = qrInfo.finalUrl
        } catch (qrErr) {
          console.warn('QR Code generation notice:', qrErr)
        }

        // ถ้าเป็นยาเก่าที่มี ID อยู่แล้ว ให้ Update
        result = await supabase
          .from('medication_templates')
          .update(medData)
          .eq('id', activeMedId)
          .select()

        if (result.data && result.data.length > 0) {
          setActiveMedDetails(result.data[0])
        }
      } else {
        // ถ้าเป็นยาใหม่ ให้ Insert
        result = await supabase
          .from('medication_templates')
          .insert([medData])
          .select()

        if (result.data && result.data.length > 0) {
          targetMedId = result.data[0].id
          setActiveMedId(targetMedId)

          // Automatically generate PDF and QR code for newly assigned ID and save
          try {
            const qrInfo = await generateAndDistributeQRCode({ ...medData, id: targetMedId })
            await supabase
              .from('medication_templates')
              .update({ qr_code_url: qrInfo.finalUrl })
              .eq('id', targetMedId)

            const savedRecord = { ...result.data[0], qr_code_url: qrInfo.finalUrl }
            setActiveMedDetails(savedRecord)
          } catch (qrErr) {
            console.warn('QR Code generation notice for new drug:', qrErr)
            setActiveMedDetails(result.data[0])
          }
        }
      }

      if (result.error) throw result.error
      alert("บันทึกข้อมูล สร้างเอกสาร PDF และ QR Code สำเร็จแล้ว!")
      fetchAllSavedDrugs()
    } catch (err) {
      alert("Save Error: " + err.message)
    }
  }

  // --- QR Code Distribution Handlers ---
  const openQrModalForMed = async (med) => {
    if (!med) return
    setQrModalMed(med)
    setShowQrModal(true)
    setQrCopied(false)
    setQrRegenSuccess(false)
    setQrLoading(true)

    try {
      let targetPdfUrl = med.qr_code_url
      if (!targetPdfUrl || !targetPdfUrl.startsWith('http')) {
        targetPdfUrl = getDirectPdfUrl(med.id)
      }
      const dataUrl = await generateQRCodeDataURL(targetPdfUrl)
      const svg = await generateQRCodeSVG(targetPdfUrl)
      setQrDataUrl(dataUrl)
      setQrSvgString(svg)
    } catch (err) {
      console.error('Error generating QR preview:', err)
    } finally {
      setQrLoading(false)
    }
  }

  const openQrModalForCurrentEditor = () => {
    if (!activeMedId) {
      alert('กรุณาบันทึกข้อมูลยาก่อนเปิดดูหรือแจกจ่าย QR Code\n(Please save the medication template first to generate its unique QR link)')
      return
    }
    const currentMed = activeMedDetails || {
      id: activeMedId,
      med_name: drugName,
      med_group: drugGroup,
      med_type: drugType,
      contents: contents,
      qr_code_url: activeMedDetails?.qr_code_url
    }
    openQrModalForMed(currentMed)
  }

  const handleRegenerateQR = async () => {
    if (!qrModalMed) return
    if (!canEditLabel(currentUser, qrModalMed)) {
      alert('You do not have permission to regenerate QR codes for this medication.')
      return
    }

    setQrLoading(true)
    setQrRegenSuccess(false)
    try {
      const qrInfo = await generateAndDistributeQRCode(qrModalMed)
      setQrDataUrl(qrInfo.dataUrl)
      setQrSvgString(qrInfo.svgString)

      const { error } = await supabase
        .from('medication_templates')
        .update({ qr_code_url: qrInfo.finalUrl })
        .eq('id', qrModalMed.id)

      if (error) throw error

      const updatedMed = { ...qrModalMed, qr_code_url: qrInfo.finalUrl }
      setQrModalMed(updatedMed)
      if (activeMedId === qrModalMed.id) {
        setActiveMedDetails(updatedMed)
      }
      setSavedDrugsList(prev => prev.map(d => d.id === qrModalMed.id ? updatedMed : d))
      setQrRegenSuccess(true)
      setTimeout(() => setQrRegenSuccess(false), 3000)
    } catch (err) {
      alert('Error regenerating QR Code: ' + err.message)
    } finally {
      setQrLoading(false)
    }
  }

  const handleCopyQrLink = () => {
    if (!qrModalMed?.id) return
    const link = qrModalMed.qr_code_url || getDirectPdfUrl(qrModalMed.id)
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        setQrCopied(true)
        setTimeout(() => setQrCopied(false), 2500)
      }).catch(() => {
        prompt('Copy this link:', link)
      })
    } else {
      prompt('Copy this link:', link)
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
        } catch {
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

  const topics = PIL_TOPIC_NAMES

  // --- 7. PDF Export ---
  const handleExportPDF = () => {
    try {
      const doc = generateMedicationPdfDoc({
        med_name: drugName,
        med_group: drugGroup,
        med_type: drugType,
        contents: contents
      }, topics)
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

  if (isDirectPdfMode) {
    return (
      <div className="direct-pdf-screen">
        {directPdfLoading ? (
          <div className="direct-pdf-loading-box">
            <div className="direct-pdf-spinner"></div>
            <p className="direct-pdf-text-th">กำลังเปิดเอกสารฉลากยา PDF...</p>
            <p className="direct-pdf-text-en">Opening PDF document...</p>
          </div>
        ) : directPdfError ? (
          <div className="direct-pdf-error-box">
            <div className="direct-pdf-error-icon">⚠️</div>
            <h3 className="direct-pdf-error-title">เกิดข้อผิดพลาด</h3>
            <p className="direct-pdf-error-msg">{directPdfError}</p>
            <button className="direct-pdf-btn-back" onClick={() => window.location.href = '/'}>
              กลับหน้าหลัก
            </button>
          </div>
        ) : (
          <div className="direct-pdf-loading-box">
            <div className="direct-pdf-spinner"></div>
            <p className="direct-pdf-text-th">กำลังเปิดไฟล์ PDF สำหรับคุณ...</p>
            <p className="direct-pdf-text-en">หากไฟล์ไม่เปิดอัตโนมัติ กรุณารอสักครู่หรือโหลดใหม่อีกครั้ง</p>
          </div>
        )}
      </div>
    )
  }

  if (isPdfViewMode) {
    return (
      <DedicatedPdfView
        drug={pdfViewDrug}
        loading={pdfViewLoading}
        error={pdfViewError}
        onBackToHome={handleBackFromPdfView}
        topics={topics}
      />
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
            {currentUser && <button className="back-btn" onClick={() => setShowLogin(false)}>✕</button>}
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

                    <div className="login-options">
                      <label>
                        <input type="checkbox" /> Remember me
                      </label>
                      <a href="#">Forgot Password?</a>
                    </div>

                    <button type="submit" className="btn-main-login" disabled={loginSubmitting}>
                      {loginSubmitting ? 'Signing in...' : 'Login'}
                    </button>
                  </form>

                  <div className="login-divider">
                    <span>or continue with</span>
                  </div>

                  <button
                    type="button"
                    className="btn-guest-login"
                    onClick={handleContinueAsGuest}
                  >
                    <div className="btn-guest-left">
                      <div className="btn-guest-icon-box">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          <path d="m9 12 2 2 4-4" />
                        </svg>
                      </div>
                      <div className="btn-guest-text-col">
                        <span className="btn-guest-title">Continue as Guest</span>
                        <span className="btn-guest-subtitle">Explore the system in read-only mode</span>
                      </div>
                    </div>
                    <div className="btn-guest-arrow">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  <h1>Create Account</h1>
                  <p>Contact admin to register a new account.</p>
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

      {/* --- 1. DASHBOARD VIEW (หลัง Login) --- */}
      {!showLogin && currentView === 'dashboard' && (
        <div className="dashboard-page-container">
          {/* Clean White Background */}

          {/* Top Navigation */}
          <header className="dashboard-header">
            {/* Left: PIL System Branding */}
            <div className="dashboard-brand">
              <div className="pil-logo-box">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="17" x2="12" y2="11"></line>
                  <line x1="9" y1="14" x2="15" y2="14"></line>
                </svg>
              </div>
              <div className="pil-brand-text-col">
                <span className="pil-brand-name">PIL System</span>
                <span className="pil-brand-subtitle">Patient Information Leaflet</span>
              </div>
            </div>

            <div className="dashboard-header-right">
              {currentUser && (
                <div className="dashboard-user-capsule" style={{ borderColor: currentUser.badgeColor }}>
                  <div className="user-avatar-circle" style={{ background: currentUser.badgeBg, color: currentUser.badgeColor }}>
                    {renderUserAvatarIcon(currentUser)}
                  </div>
                  <div className="user-text-column">
                    <span className="user-email-text">{currentUser.name}</span>
                    <span className="user-role-subtext" style={{ color: currentUser.badgeColor }}>
                      {currentUser.role} {currentUser.isGuest ? '(Read-Only)' : ''}
                    </span>
                  </div>
                </div>
              )}
              <button className="dashboard-logout-btn" onClick={handleLogout} title="Sign Out">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Sign Out</span>
              </button>
            </div>
          </header>

          {/* Main Hero Area with Floating White Card */}
          <main className="dashboard-main-content">
            {currentUser?.isGuest ? (
              <div className="guest-hero-container">
                <div className="guest-hero-card">
                  {/* Top Badge */}
                  <div className="guest-hero-badge">
                    <span className="guest-badge-dot"></span>
                    <span>Document Management System for Public Medication Information</span>
                  </div>

                  {/* Main Title */}
                  <h1 className="guest-main-title">
                    Patient Information<br />
                    <span className="guest-leaflet-italic">Leaflet</span>
                  </h1>

                  {/* Subtitle */}
                  <p className="guest-main-subtitle">
                    Browse and explore public medication documents as a read-only guest.
                  </p>

                  {/* Primary Blue Action Button: Drug Data */}
                  <button
                    className="guest-drug-data-btn"
                    onClick={() => {
                      setManageMainTab('drug_data')
                      setManageSubCategory('all_drugs')
                      setManageSearchQuery('')
                      setCurrentView('manage_data')
                      fetchAllSavedDrugs()
                    }}
                    title="Drug Data"
                  >
                    <div className="guest-drug-data-left">
                      <div className="guest-drug-data-icon-box">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                          <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                          <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                          <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                        </svg>
                      </div>
                      <div className="guest-drug-data-texts">
                        <span className="guest-drug-data-title">Drug Data</span>
                        <span className="guest-drug-data-subtitle">Drug Library · Topics · Footer</span>
                      </div>
                    </div>
                    <div className="guest-drug-data-arrow">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  </button>

                  {/* Quick Access Divider */}
                  <div className="guest-quick-access-divider">
                    <span>quick access</span>
                  </div>

                  {/* Quick Access Sub-buttons */}
                  <div className="guest-sub-pills-row">
                    <button
                      className="guest-sub-pill"
                      onClick={() => setActiveModal('import_word')}
                      title="Import (.docx)"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                      <span>Import (.docx)</span>
                    </button>

                    <button
                      className="guest-sub-pill"
                      onClick={() => setActiveModal('join_code')}
                      title="6-digit Code"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                        <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                        <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                        <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                      </svg>
                      <span>6-digit Code</span>
                    </button>
                  </div>

                  {/* Card Footer: Supported by PSU */}
                  <div className="guest-card-footer">
                    <span className="footer-supported-text">Supported by</span>
                    <div className="psu-badge">
                      <svg className="psu-info-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <span className="psu-badge-text">PSU · Prince of Songkla University</span>
                    </div>
                  </div>
                </div>

                {/* Note below card */}
                <p className="guest-disclaimer-text">
                  You are browsing as a guest with read-only access.
                </p>
              </div>
            ) : (
              <div className="dashboard-white-card">
              {/* Top Badge */}
              <div className="dashboard-hero-badge">
                <span className="badge-dot"></span>
                <span>Document Management System for Public Medication Information</span>
              </div>

              {/* Main Title */}
              <h1 className="dashboard-main-title">
                Patient Information <span className="leaflet-italic">Leaflet</span>
              </h1>

              {/* Subtitle */}
              <p className="dashboard-main-subtitle">
                Create and manage PIL documents professionally with ease.
              </p>

              {/* Action Cards Grid */}
              <div className="dashboard-cards-grid">
                {/* Card 1: Create New Document */}
                <div
                  className={`action-card card-create-new ${!canCreateLabel(currentUser) ? 'card-disabled-guest' : ''}`}
                  onClick={handleStartNewDoc}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleStartNewDoc() }}
                  title={!canCreateLabel(currentUser) ? 'ผู้เยี่ยมชม (Guest) มีสิทธิ์อ่านอย่างเดียว ไม่สามารถสร้างเอกสารใหม่ได้' : 'Create New Document'}
                >
                  <div className="card-left-group">
                    <div className="card-icon-box icon-box-create">
                      {!canCreateLabel(currentUser) ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      )}
                    </div>
                    <div className="card-text-group">
                      <h2 className="card-title">
                        Create New Document
                        {!canCreateLabel(currentUser) && <span className="card-lock-tag">Read-Only</span>}
                      </h2>
                      <p className="card-subtitle">
                        {!canCreateLabel(currentUser) ? 'Guest role is restricted to read-only' : 'Start from a blank document'}
                      </p>
                    </div>
                  </div>
                  <div className="card-arrow-cue">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>

                {/* Card 2: Manage Data */}
                <div
                  className="action-card card-manage-data"
                  onClick={() => setCurrentView('manage_data')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCurrentView('manage_data') }}
                  title="Manage Data"
                >
                  <div className="card-left-group">
                    <div className="card-icon-box icon-box-manage">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="7" x2="20" y2="7"></line>
                        <line x1="4" y1="12" x2="20" y2="12"></line>
                        <line x1="4" y1="17" x2="20" y2="17"></line>
                      </svg>
                    </div>
                    <div className="card-text-group">
                      <h2 className="card-title">Manage Data</h2>
                      <p className="card-subtitle">Drug Library · Topics · Footer</p>
                    </div>
                  </div>
                  <div className="card-arrow-cue secondary">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Sub-action Pills */}
              <div className="dashboard-pills-row">
                <button
                  className="dashboard-sub-pill"
                  onClick={() => setActiveModal('import_word')}
                  title="Import from Word (.docx)"
                >
                  <svg className="pill-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  <span>Import from Word (.docx)</span>
                </button>

                <button
                  className="dashboard-sub-pill"
                  onClick={() => setActiveModal('join_code')}
                  title="Join with 6-digit Code"
                >
                  <svg className="pill-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                  </svg>
                  <span>Join with 6-digit Code</span>
                </button>
              </div>

              {/* Card Footer: Supported by PSU */}
              <div className="dashboard-card-footer">
                <span className="footer-supported-text">Supported by</span>
                <div className="psu-badge">
                  <svg className="psu-info-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span className="psu-badge-text">PSU · Prince of Songkla University</span>
                </div>
              </div>
            </div>
          )}
        </main>

          {/* Interactive Modal for secondary features */}
          {activeModal && (
            <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
              <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>

                {activeModal === 'manage_data' && (
                  <div className="modal-body-section">
                    <div className="modal-icon-badge">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2">
                        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                      </svg>
                    </div>
                    <h3>จัดการข้อมูลคลังยาและหัวข้อ</h3>
                    <p>ระบบบันทึกและจัดการคลังยาเชื่อมต่อกับฐานข้อมูล Supabase เรียบร้อยแล้ว ท่านสามารถค้นหายาเดิมและบันทึกเทมเพลตได้ทันทีในหน้าตัวแก้ไข</p>
                    <div className="modal-action-row">
                      <button className="btn-modal-primary" onClick={() => { setActiveModal(null); setCurrentView('editor'); }}>
                        ไปที่หน้าตัวแก้ไขข้อมูลยา
                      </button>
                    </div>
                  </div>
                )}

                {activeModal === 'import_word' && (
                  <div className="modal-body-section">
                    <div className="modal-icon-badge doc">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                    </div>
                    <h3>นำเข้าจากไฟล์ Word (.docx)</h3>
                    <p>ฟังก์ชันนำเข้าไฟล์ Word อยู่ระหว่างพัฒนา ท่านสามารถกดเริ่มต้นสร้างเอกสารใหม่และกรอกข้อมูลในระบบได้ทันที</p>
                    <div className="modal-action-row">
                      <button className="btn-modal-primary" onClick={() => { setActiveModal(null); handleStartNewDoc(); }}>
                        สร้างเอกสารใหม่
                      </button>
                    </div>
                  </div>
                )}

                {activeModal === 'join_code' && (
                  <div className="modal-body-section">
                    <div className="modal-icon-badge code">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                      </svg>
                    </div>
                    <h3>เข้าร่วมด้วยรหัส 6 หลัก</h3>
                    <p>ป้อนรหัส 6 หลักเพื่อดึงเทมเพลตยาหรือร่วมจัดการเอกสาร</p>
                    <div className="code-input-row">
                      <input
                        type="text"
                        maxLength="6"
                        placeholder="123456"
                        className="join-code-input"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                      />
                    </div>
                    <div className="modal-action-row">
                      <button
                        className="btn-modal-primary"
                        onClick={() => {
                          if (joinCode.length === 6) {
                            alert(`กำลังค้นหารหัส: ${joinCode}`);
                            setActiveModal(null);
                          } else {
                            alert("กรุณาป้อนรหัสให้ครบ 6 หลัก");
                          }
                        }}
                      >
                        ยืนยันรหัส
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- 2. MANAGE DATA VIEW (Full English UI matching mockup) --- */}
      {!showLogin && currentView === 'manage_data' && (
        currentUser?.isGuest ? (
          <div className="guest-drug-page">

            {/* Top Navigation Header */}
            <header className="manage-header">
              <div className="dashboard-brand">
                <div className="pil-logo-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="12" y1="17" x2="12" y2="11"></line>
                    <line x1="9" y1="14" x2="15" y2="14"></line>
                  </svg>
                </div>
                <div className="pil-brand-text-col">
                  <span className="pil-brand-name">PIL System</span>
                  <span className="pil-brand-subtitle">Patient Information Leaflet</span>
                </div>
              </div>

              <div className="dashboard-header-right">
                {currentUser && (
                  <div className="dashboard-user-capsule" style={{ borderColor: currentUser.badgeColor }}>
                    <div className="user-avatar-circle" style={{ background: currentUser.badgeBg, color: currentUser.badgeColor }}>
                      {renderUserAvatarIcon(currentUser)}
                    </div>
                    <div className="user-text-column">
                      <span className="user-email-text">{currentUser.name}</span>
                      <span className="user-role-subtext" style={{ color: currentUser.badgeColor }}>
                        {currentUser.role} (Read-Only)
                      </span>
                    </div>
                  </div>
                )}
                <button className="dashboard-logout-btn" onClick={handleLogout} title="Sign Out">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Sign Out</span>
                </button>
              </div>
            </header>

            {/* Main Content matching Image 2 */}
            <main className="guest-drug-content">
              {/* Back Navigation Link */}
              <button className="guest-back-btn" onClick={() => setCurrentView('dashboard')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Back to Dashboard</span>
              </button>

              {/* Hero Header Section */}
              <div className="guest-drug-hero">
                <div className="guest-drug-hero-left">
                  <div className="guest-section-tag">READ-ONLY ACCESS</div>
                  <h1 className="guest-drug-title">Drug Data</h1>
                  <p className="guest-drug-desc">
                    Browse medication topics available in the PIL document library.
                  </p>
                </div>
                <div className="guest-items-counter">
                  {(() => {
                    const isAll = !manageSubCategory || manageSubCategory === 'all_drugs'
                    const filtered = savedDrugsList.filter(d => {
                      const q = manageSearchQuery.toLowerCase().trim()
                      const matchesSearch =
                        !q ||
                        (d.med_name || '').toLowerCase().includes(q) ||
                        (d.med_type || '').toLowerCase().includes(q) ||
                        (d.med_group || '').toLowerCase().includes(q)
                      const matchesGroup = isAll || d.med_group === manageSubCategory
                      return matchesSearch && matchesGroup
                    })
                    return `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`
                  })()}
                </div>
              </div>

              {/* Category Filter Pills */}
              {(() => {
                const categories = Array.from(
                  new Set([
                    ...drugGroups,
                    ...savedDrugsList.map(d => d.med_group).filter(Boolean)
                  ])
                )
                const isAllSelected = !manageSubCategory || manageSubCategory === 'all_drugs'

                return (
                  <div className="guest-pills-row">
                    <button
                      className={`guest-cat-pill ${isAllSelected ? 'active' : ''}`}
                      onClick={() => {
                        setManageSubCategory('all_drugs')
                        setManageSearchQuery('')
                      }}
                    >
                      All Medications
                    </button>
                    {categories.map((cat) => {
                      const isCatActive = manageSubCategory === cat
                      return (
                        <button
                          key={cat}
                          className={`guest-cat-pill ${isCatActive ? 'active' : ''}`}
                          onClick={() => {
                            setManageSubCategory(cat)
                            setManageSearchQuery('')
                          }}
                        >
                          {cat}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}

              {/* White Medication Panel Card */}
              <div className="guest-med-panel">
                {/* Panel Header */}
                <div className="guest-panel-header">
                  <div className="guest-panel-left">
                    <div className="guest-panel-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                    </div>
                    <div className="guest-panel-title-group">
                      <div className="guest-panel-title-row">
                        <h2 className="guest-panel-title">Medication Library</h2>
                        <button
                          className="guest-sync-btn"
                          onClick={() => fetchAllSavedDrugs()}
                          title="Sync with Supabase"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                          </svg>
                          <span>Sync</span>
                        </button>
                      </div>
                      <p className="guest-panel-desc">
                        View and manage saved drug templates in the database
                      </p>
                    </div>
                  </div>

                  <div className="guest-panel-right">
                    <div className="guest-search-box">
                      <svg className="guest-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <input
                        type="text"
                        placeholder="Search items..."
                        className="guest-search-input"
                        value={manageSearchQuery}
                        onChange={(e) => setManageSearchQuery(e.target.value)}
                      />
                      {manageSearchQuery && (
                        <button className="guest-search-clear" onClick={() => setManageSearchQuery('')}>✕</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Medication Items List */}
                <div className="guest-med-list">
                  {(() => {
                    const isAll = !manageSubCategory || manageSubCategory === 'all_drugs'
                    const filtered = savedDrugsList.filter(d => {
                      const q = manageSearchQuery.toLowerCase().trim()
                      const matchesSearch =
                        !q ||
                        (d.med_name || '').toLowerCase().includes(q) ||
                        (d.med_type || '').toLowerCase().includes(q) ||
                        (d.med_group || '').toLowerCase().includes(q)
                      const matchesGroup = isAll || d.med_group === manageSubCategory
                      return matchesSearch && matchesGroup
                    })

                    if (filtered.length === 0) {
                      return (
                        <div className="guest-empty-state">
                          <p>No medication templates found.</p>
                        </div>
                      )
                    }

                    return filtered.map((drug, index) => {
                      const initial = (drug.med_name ? drug.med_name.trim().charAt(0).toUpperCase() : 'M')
                      const avatarBg = getMedAvatarBg(drug.med_name, index)
                      const ownerName = drug.created_by_name || drug.last_updated_by || 'Hospital Staff'

                      return (
                        <div key={drug.id} className="guest-med-row">
                          <div className="guest-med-row-left">
                            <div className="guest-med-avatar" style={{ backgroundColor: avatarBg }}>
                              {initial}
                            </div>
                            <div className="guest-med-info">
                              <div className="guest-med-name-row">
                                <span className="guest-med-name">{drug.med_name}</span>
                                {ownerName && (
                                  <span className="guest-creator-pill" title={`Created by ${ownerName}`}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                      <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span>{ownerName}</span>
                                  </span>
                                )}
                              </div>
                              <div className="guest-med-meta">
                                {drug.med_type ? `${drug.med_type} · ` : ''}
                                {drug.med_group ? `${drug.med_group} · ` : ''}
                                Updated by {drug.last_updated_by || ownerName}
                              </div>
                            </div>
                          </div>

                          <div className="guest-med-row-right">
                            <button
                              className="guest-qr-btn"
                              onClick={() => openQrModalForMed(drug)}
                              title="Download QR Code (PNG / SVG)"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                              </svg>
                              <span>QR Code</span>
                            </button>
                            <button
                              className="guest-view-btn"
                              onClick={() => {
                                selectMedTemplate(drug)
                                setCurrentView('editor')
                              }}
                              title="View Document (Read-Only)"
                            >
                              View (Read-Only)
                            </button>
                            <span className="guest-locked-badge" title="Editing and deleting are locked for guest users">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                              </svg>
                              <span>Locked</span>
                            </span>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>

              {/* Card Footer: Supported by PSU */}
              <div className="guest-page-footer">
                <span className="footer-supported-text">Supported by</span>
                <div className="psu-badge">
                  <svg className="psu-info-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span className="psu-badge-text">PSU · Prince of Songkla University</span>
                </div>
              </div>
            </main>
          </div>
        ) : (
          <div className="manage-page-container">
          {/* Top Navigation Header */}
          <header className="manage-header">
            <div className="dashboard-brand">
              <div className="pil-logo-box">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="17" x2="12" y2="11"></line>
                  <line x1="9" y1="14" x2="15" y2="14"></line>
                </svg>
              </div>
              <div className="pil-brand-text-col">
                <span className="pil-brand-name">PIL System</span>
                <span className="pil-brand-subtitle">Patient Information Leaflet</span>
              </div>
            </div>

            <div className="dashboard-header-right">
              {currentUser && (
                <div className="dashboard-user-capsule" style={{ borderColor: currentUser.badgeColor }}>
                  <div className="user-avatar-circle" style={{ background: currentUser.badgeBg, color: currentUser.badgeColor }}>
                    {renderUserAvatarIcon(currentUser)}
                  </div>
                  <div className="user-text-column">
                    <span className="user-email-text">{currentUser.name}</span>
                    <span className="user-role-subtext" style={{ color: currentUser.badgeColor }}>
                      {currentUser.role} {currentUser.isGuest ? '(Read-Only)' : ''}
                    </span>
                  </div>
                </div>
              )}
              <button className="dashboard-logout-btn" onClick={handleLogout} title="Sign Out">
                <svg width="17" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Sign Out</span>
              </button>
            </div>
          </header>

          {/* Main Manage Data Container */}
          <main className="manage-main-content">
            {/* Back Navigation Link */}
            <button className="manage-back-btn" onClick={() => setCurrentView('dashboard')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Dashboard</span>
            </button>

            {/* Hero Header Section */}
            <div className="manage-hero-section">
              <div className="manage-hero-left">
                <div className="manage-section-badge">
                  <span className="manage-badge-dot"></span>
                  <span>DOCUMENT SETUP</span>
                </div>
                <h1 className="manage-title">Manage Data</h1>
                <p className="manage-subtitle">
                  Organize and manage PIL document components systematically for seamless reuse across all documents.
                </p>
              </div>
              <div className="manage-count-badge">
                {(() => {
                  if (manageMainTab === 'drug_data') {
                    const isAll = !manageSubCategory || manageSubCategory === 'all_drugs' || manageSubCategory.startsWith('topic') || manageSubCategory.startsWith('footer')
                    const filteredDrugs = savedDrugsList.filter(d => {
                      const matchesSearch =
                        (d.med_name || '').toLowerCase().includes(manageSearchQuery.toLowerCase()) ||
                        (d.med_type || '').toLowerCase().includes(manageSearchQuery.toLowerCase())
                      const matchesGroup = isAll || d.med_group === manageSubCategory
                      return matchesSearch && matchesGroup
                    })
                    return `${filteredDrugs.length} ${filteredDrugs.length === 1 ? 'item' : 'items'}`
                  }
                  if (manageMainTab === 'topics') {
                    if (isLoadingTopic && (!supabaseTopicsData[manageSubCategory] || supabaseTopicsData[manageSubCategory].length === 0)) {
                      return 'Loading...'
                    }
                    const list = supabaseTopicsData[manageSubCategory] || []
                    const filtered = list.filter(item =>
                      (item.name || '').toLowerCase().includes(manageSearchQuery.toLowerCase().trim())
                    )
                    return `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`
                  }
                  const list = (manageData[manageMainTab] && manageData[manageMainTab][manageSubCategory]) || []
                  const filtered = list.filter(item =>
                    (item.text || '').toLowerCase().includes(manageSearchQuery.toLowerCase().trim())
                  )
                  return `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`
                })()}
              </div>
            </div>

            {/* Primary Navigation Tabs */}
            <div className="manage-primary-tabs">
              <button
                className={`manage-tab-btn ${manageMainTab === 'topics' ? 'active' : ''}`}
                onClick={() => {
                  setManageMainTab('topics')
                  setManageSubCategory('topic1')
                  setManageSearchQuery('')
                }}
              >
                Topics
              </button>
              <button
                className={`manage-tab-btn ${manageMainTab === 'footer' ? 'active' : ''}`}
                onClick={() => {
                  setManageMainTab('footer')
                  setManageSubCategory('footer_statements')
                  setManageSearchQuery('')
                }}
              >
                Footer
              </button>
              <button
                className={`manage-tab-btn ${manageMainTab === 'drug_data' ? 'active' : ''}`}
                onClick={() => {
                  setManageMainTab('drug_data')
                  setManageSubCategory('all_drugs')
                  setManageSearchQuery('')
                  fetchAllSavedDrugs()
                }}
              >
                Drug Data
              </button>
            </div>

            {/* Secondary Sub-Category Pills */}
            {manageMainTab === 'footer' && (
              <div className="manage-pills-container">
                {FOOTER_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    className={`manage-category-pill ${manageSubCategory === cat.id ? 'active' : ''}`}
                    onClick={() => {
                      setManageSubCategory(cat.id)
                      setManageSearchQuery('')
                    }}
                  >
                    {cat.hasIcon && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                      </svg>
                    )}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}

            {manageMainTab === 'topics' && (
              <div className="manage-pills-container">
                {TOPIC_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    className={`manage-category-pill ${manageSubCategory === cat.id ? 'active' : ''}`}
                    onClick={() => {
                      setManageSubCategory(cat.id)
                      setManageSearchQuery('')
                    }}
                  >
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}

            {manageMainTab === 'drug_data' && (
              <div className="manage-pills-container">
                <button
                  className={`manage-category-pill ${manageSubCategory === 'all_drugs' ? 'active' : ''}`}
                  onClick={() => {
                    setManageSubCategory('all_drugs')
                    setManageSearchQuery('')
                  }}
                >
                  <span>All Medications</span>
                </button>
                {drugGroups.map(grp => (
                  <button
                    key={grp}
                    className={`manage-category-pill ${manageSubCategory === grp ? 'active' : ''}`}
                    onClick={() => {
                      setManageSubCategory(grp)
                      setManageSearchQuery('')
                    }}
                  >
                    <span>{grp}</span>
                  </button>
                ))}
              </div>
            )}

            {/* White Container Card */}
            <div className="manage-white-panel">
              {/* Card Header: Section Titles & Search Box */}
              <div className="manage-panel-header">
                <div className="manage-panel-titles">
                  <div className="manage-title-with-refresh">
                    <h2 className="manage-panel-title">
                      {manageMainTab === 'drug_data'
                        ? 'Medication Library'
                        : (CATEGORY_META[manageSubCategory]?.title || 'Items')}
                    </h2>
                    {(manageMainTab === 'topics' || manageMainTab === 'drug_data') && (
                      <button
                        className="manage-refresh-btn"
                        onClick={() => {
                          if (manageMainTab === 'topics') fetchSupabaseTopic(manageSubCategory, true)
                          else fetchAllSavedDrugs()
                        }}
                        title="Sync / Refresh with Supabase"
                        disabled={manageMainTab === 'topics' ? isLoadingTopic : false}
                      >
                        <svg className={(manageMainTab === 'topics' && isLoadingTopic) ? 'rotating' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10"></polyline>
                          <polyline points="1 20 1 14 7 14"></polyline>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        <span>Sync</span>
                      </button>
                    )}
                  </div>
                  <p className="manage-panel-desc">
                    {manageMainTab === 'drug_data'
                      ? 'View and manage saved drug templates in the database'
                      : (CATEGORY_META[manageSubCategory]?.subtitle || 'Add or edit your document entries')}
                  </p>
                </div>

                <div className="manage-search-wrapper">
                  <svg className="manage-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search items..."
                    className="manage-search-field"
                    value={manageSearchQuery}
                    onChange={(e) => setManageSearchQuery(e.target.value)}
                  />
                  {manageSearchQuery && (
                    <button className="manage-search-clear" onClick={() => setManageSearchQuery('')}>✕</button>
                  )}
                </div>
              </div>

              {/* Add New Item Input Row (Guarded for Admin in Topics & Footer) */}
              {manageMainTab !== 'drug_data' && (
                canManageSystemTopics(currentUser) ? (
                  <div className="manage-add-row">
                    {manageMainTab === 'topics' && (TOPIC_SUB_OPTIONS[manageSubCategory]?.length > 0) && (
                      <select
                        className="manage-subtopic-select"
                        value={selectedSubTopic}
                        onChange={(e) => setSelectedSubTopic(e.target.value)}
                        disabled={isLoadingTopic}
                        title="เลือกรหัสหัวข้อย่อย (Sub Topic)"
                      >
                        {TOPIC_SUB_OPTIONS[manageSubCategory].map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      placeholder={`Add "${CATEGORY_META[manageSubCategory]?.placeholder || 'new entry'}"...`}
                      className="manage-add-field"
                      value={manageNewItemInput}
                      onChange={(e) => setManageNewItemInput(e.target.value)}
                      disabled={manageMainTab === 'topics' && isLoadingTopic}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (manageMainTab === 'topics') {
                            handleAddTopicItem(manageSubCategory, manageNewItemInput)
                          } else {
                            handleAddManageItem()
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="manage-add-btn"
                      disabled={manageMainTab === 'topics' && isLoadingTopic}
                      onClick={(e) => {
                        e.preventDefault()
                        if (manageMainTab === 'topics') {
                          handleAddTopicItem(manageSubCategory, manageNewItemInput)
                        } else {
                          handleAddManageItem()
                        }
                      }}
                    >
                      <svg className={(manageMainTab === 'topics' && isLoadingTopic) ? 'rotating' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        {manageMainTab === 'topics' && isLoadingTopic ? (
                          <>
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                          </>
                        ) : (
                          <>
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </>
                        )}
                      </svg>
                      <span>{(manageMainTab === 'topics' && isLoadingTopic) ? 'Adding...' : 'Add Item'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="manage-system-readonly-notice">
                    <span className="readonly-notice-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <span className="readonly-notice-text">
                      Standard PIL components are read-only for <strong>{currentUser?.title || 'User'}</strong>. Administrator privilege is required to modify.
                    </span>
                  </div>
                )
              )}

              {/* Items List */}
              <div className="manage-list-container">
                {manageMainTab === 'drug_data' ? (
                  /* Medication Library List */
                  (() => {
                    const isAll = !manageSubCategory || manageSubCategory === 'all_drugs' || manageSubCategory.startsWith('topic') || manageSubCategory.startsWith('footer')
                    const filteredDrugs = savedDrugsList.filter(d => {
                      const matchesSearch =
                        (d.med_name || '').toLowerCase().includes(manageSearchQuery.toLowerCase()) ||
                        (d.med_type || '').toLowerCase().includes(manageSearchQuery.toLowerCase())
                      const matchesGroup = isAll || d.med_group === manageSubCategory
                      return matchesSearch && matchesGroup
                    })

                    if (filteredDrugs.length === 0) {
                      return (
                        <div className="manage-empty-box">
                          <p>No medication templates found.</p>
                        </div>
                      )
                    }

                    return filteredDrugs.map(drug => {
                      const isOwner = isLabelOwner(currentUser, drug)
                      const canEditThis = canEditLabel(currentUser, drug)
                      const canDeleteThis = canDeleteLabel(currentUser, drug)
                      const denialReason = !canEditThis ? getPermissionDenialReason(currentUser, 'edit', drug) : null

                      return (
                        <div key={drug.id} className="manage-item-card">
                          <div className="manage-item-left">
                            <div className="manage-avatar-badge drug-avatar">
                              <span>{(drug.med_name ? drug.med_name.charAt(0).toUpperCase() : 'M')}</span>
                            </div>
                            <div className="manage-item-text-group">
                              <div className="manage-title-with-badge">
                                <span className="manage-item-title">{drug.med_name}</span>
                                {isOwner ? (
                                  <span className="owner-badge you" title="You created this record (Full Ownership)">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                      <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span>Your Record (Owner)</span>
                                  </span>
                                ) : drug.created_by_name ? (
                                  <span className="owner-badge other" title={`Created by ${drug.created_by_name}`}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                      <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span>{drug.created_by_name}</span>
                                  </span>
                                ) : null}
                              </div>
                              <span className="manage-item-meta">
                                {drug.med_type || 'General'} · {drug.med_group || 'No Group'} · Updated by {drug.last_updated_by || 'User'}
                              </span>
                            </div>
                          </div>
                          <div className="manage-item-actions">
                            <button
                              className="manage-qr-btn"
                              onClick={() => openQrModalForMed(drug)}
                              title="View, Print & Download QR Code"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                              </svg>
                              <span>QR Code</span>
                            </button>
                            <button
                              className={`manage-use-btn ${!canEditThis ? 'read-only' : ''}`}
                              onClick={() => { selectMedTemplate(drug); setCurrentView('editor'); }}
                              title={canEditThis ? "Open in Editor" : denialReason?.th}
                            >
                              {canEditThis ? 'Open in Editor' : 'View (Read-Only)'}
                            </button>
                            {canDeleteThis ? (
                              <button
                                className="manage-delete-btn"
                                onClick={() => handleDeleteSavedDrug(drug.id, drug.med_name)}
                                title="Delete"
                              >
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"></polyline>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                              </button>
                            ) : (
                              <span
                                className="manage-locked-tag"
                                title={getPermissionDenialReason(currentUser, 'delete', drug).th}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                                <span>Locked</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  })()
                ) : manageMainTab === 'topics' ? (
                  /* Live Supabase Topics List */
                  (() => {
                    if (isLoadingTopic && (!supabaseTopicsData[manageSubCategory] || supabaseTopicsData[manageSubCategory].length === 0)) {
                      return (
                        <div className="manage-loading-box">
                          <div className="manage-loading-spinner"></div>
                          <p>Loading items from Supabase database...</p>
                        </div>
                      )
                    }

                    const topicItems = supabaseTopicsData[manageSubCategory] || []
                    const filtered = topicItems.filter(item =>
                      (item.name || '').toLowerCase().includes(manageSearchQuery.toLowerCase().trim())
                    )

                    if (filtered.length === 0) {
                      return (
                        <div className="manage-empty-box">
                          <p>No items found{manageSearchQuery ? ` matching "${manageSearchQuery}"` : ' in this topic'}.</p>
                        </div>
                      )
                    }

                    return filtered.map(item => (
                      <div key={item.id} className="manage-item-card">
                        <div className="manage-item-left">
                          {manageEditingId === item.id ? (
                            <input
                              type="text"
                              className="manage-inline-edit-field"
                              value={manageEditingText}
                              onChange={(e) => setManageEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTopicEdit(manageSubCategory, item.id, manageEditingText)
                                if (e.key === 'Escape') handleCancelEditItem()
                              }}
                              autoFocus
                              disabled={topicSaveStatus?.id === item.id && topicSaveStatus?.status === 'saving'}
                            />
                          ) : (
                            <div className="manage-item-content-group">
                              <span className="manage-item-title">{item.name}</span>
                              {item.sub_topic && (
                                <span className="manage-subtopic-badge">
                                  {item.sub_topic}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="manage-item-actions">
                          {canManageSystemTopics(currentUser) ? (
                            manageEditingId === item.id ? (
                              <>
                                {topicSaveStatus?.id === item.id && topicSaveStatus?.status === 'saving' ? (
                                  <span className="manage-status-tag saving">Saving...</span>
                                ) : topicSaveStatus?.id === item.id && topicSaveStatus?.status === 'saved' ? (
                                  <span className="manage-status-tag saved">✓ Saved</span>
                                ) : (
                                  <>
                                    <button
                                      className="manage-save-btn"
                                      onClick={() => handleSaveTopicEdit(manageSubCategory, item.id, manageEditingText)}
                                    >
                                      Save
                                    </button>
                                    <button className="manage-cancel-btn" onClick={handleCancelEditItem}>Cancel</button>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  className="manage-edit-link"
                                  onClick={() => {
                                    setManageEditingId(item.id)
                                    setManageEditingText(item.name)
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="manage-delete-btn"
                                  onClick={() => handleDeleteTopicItem(manageSubCategory, item.id, item.name)}
                                  title="Delete"
                                >
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                  </svg>
                                </button>
                              </>
                            )
                          ) : (
                            <span className="manage-readonly-chip" title="Admin only">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                              </svg>
                              <span>Read-Only</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  })()
                ) : (
                  /* Footer Items List */
                  (() => {
                    const items = (manageData[manageMainTab] && manageData[manageMainTab][manageSubCategory]) || []
                    const filtered = items.filter(item =>
                      (item.text || '').toLowerCase().includes(manageSearchQuery.toLowerCase().trim())
                    )

                    if (filtered.length === 0) {
                      return (
                        <div className="manage-empty-box">
                          <p>No items found{manageSearchQuery ? ` matching "${manageSearchQuery}"` : ''}.</p>
                        </div>
                      )
                    }

                    return filtered.map(item => (
                      <div key={item.id} className="manage-item-card">
                        <div className="manage-item-left">
                          <div className="manage-avatar-badge">
                            <span>{getItemAvatarChar(item.text)}</span>
                          </div>
                          {manageEditingId === item.id ? (
                            <input
                              type="text"
                              className="manage-inline-edit-field"
                              value={manageEditingText}
                              onChange={(e) => setManageEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEditItem(item.id)
                                if (e.key === 'Escape') handleCancelEditItem()
                              }}
                              autoFocus
                            />
                          ) : (
                            <span className="manage-item-title">{item.text}</span>
                          )}
                        </div>

                        <div className="manage-item-actions">
                          {canManageSystemTopics(currentUser) ? (
                            manageEditingId === item.id ? (
                              <>
                                <button className="manage-save-btn" onClick={() => handleSaveEditItem(item.id)}>Save</button>
                                <button className="manage-cancel-btn" onClick={handleCancelEditItem}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="manage-edit-link" onClick={() => handleStartEditItem(item)}>Edit</button>
                                <button
                                  className="manage-delete-btn"
                                  onClick={() => handleDeleteManageItem(item.id)}
                                  title="Delete"
                                >
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                  </svg>
                                </button>
                              </>
                            )
                          ) : (
                            <span className="manage-readonly-chip" title="Admin only">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                              </svg>
                              <span>Read-Only</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  })()
                )}
              </div>
            </div>
          </main>
        </div>
        )
      )}

      {/* --- 3. EDITOR VIEW (หน้ากรอกข้อมูลยาเดิม) --- */}
      {!showLogin && currentView === 'editor' && (
        <>
          {/* --- MAIN NAVIGATION --- */}
          <nav className="main-top-nav">
            <div className="nav-container">
              <div className="nav-left-area">
                <button
                  className="btn-back-to-dashboard"
                  onClick={handleBackToDashboard}
                  title="กลับสู่หน้าหลัก"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6"/>
                  </svg>
                  <span>หน้าหลัก</span>
                </button>
                <img src="/image/psu-logo.png" alt="PSU Logo" className="nav-logo" />
                {currentUser && (
                  <span className="user-email-label auth-editor-badge" style={{ borderColor: currentUser.badgeColor }}>
                    {renderUserAvatarIcon(currentUser)} {currentUser.name} ({currentUser.role})
                  </span>
                )}
              </div>
              <div className="nav-center-area">
                <h1 className="nav-title-eng">Medication Label</h1>
              </div>

              <div className="nav-right-area">
                {(() => {
                  const canSave = activeMedId
                    ? canEditLabel(currentUser, activeMedDetails)
                    : (canCreateLabel(currentUser) && (currentUser?.role !== ROLES.PHARMACIST || canAccessMedicineCategory(currentUser, drugGroup)))
                  const denial = !canSave
                    ? getPermissionDenialReason(currentUser, activeMedId ? 'edit' : 'create', activeMedDetails || { med_group: drugGroup })
                    : null

                  return (
                    <button
                      className={`btn-save-nav ${!canSave ? 'guarded-disabled' : ''}`}
                      onClick={handleSaveTemplate}
                      disabled={!canSave}
                      title={!canSave ? denial?.th : 'Save Template'}
                    >
                      {!canSave ? 'Save (Locked)' : 'Save Template'}
                    </button>
                  )
                })()}
                <button
                  className="btn-clear-nav"
                  onClick={(e) => handleClearAll(e)}
                  disabled={!currentUser || currentUser?.role === ROLES.GUEST}
                  title={currentUser?.role === ROLES.GUEST ? 'ผู้เยี่ยมชมไม่สามารถแก้ไขข้อมูลได้' : 'Clear All'}
                >
                  Clear All
                </button>
                <button
                  className="btn-qr-nav"
                  onClick={openQrModalForCurrentEditor}
                  title="View, Print & Download QR Code"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                  <span>QR Code</span>
                </button>
                <button className="btn-export-nav" onClick={handleExportPDF}>Export PDF</button>
                <button className="btn-login-nav logout" onClick={handleLogout}>Logout</button>
              </div>
            </div>
          </nav>

          {/* --- EDITOR CANVAS --- */}
          <main className="pil-editor-canvas">
            {/* Permission Guard Notification Banner for Editor */}
            {(() => {
              const canSave = activeMedId
                ? canEditLabel(currentUser, activeMedDetails)
                : (canCreateLabel(currentUser) && (currentUser?.role !== ROLES.PHARMACIST || canAccessMedicineCategory(currentUser, drugGroup)))

              if (canSave) {
                if (activeMedDetails) {
                  const isOwner = isLabelOwner(currentUser, activeMedDetails)
                  return (
                    <div className="editor-ownership-status-bar authorized">
                      <span>
                        {isOwner ? 'You are the Creator & Owner of this record (Full Edit Rights)' : `Admin Override: Full Edit Access (${activeMedDetails.created_by_name || 'Hospital Staff'})`}
                      </span>
                    </div>
                  )
                }
                return null
              }

              const denial = getPermissionDenialReason(currentUser, activeMedId ? 'edit' : 'create', activeMedDetails || { med_group: drugGroup })
              return (
                <div className="editor-ownership-status-bar blocked">
                  <span className="guard-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <span>
                    <strong>Access Control Notice ({currentUser?.title || 'Notice'}):</strong> {denial?.th}
                  </span>
                </div>
              )
            })()}

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
        </>
      )}

      {/* Floating Help Button (?) at bottom right */}
      <button
        className="floating-help-btn"
        onClick={() => alert("PIL System - Patient Information Leaflet\nDocument Management System for Public Medication Information\nSupported by PSU · Prince of Songkla University")}
        title="Help & Support"
        aria-label="Help & Support"
      >
        ?
      </button>

      {/* --- QR Code Distribution Modal --- */}
      {showQrModal && qrModalMed && (
        <div className="qr-modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="qr-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-header">
              <div className="qr-modal-title-group">
                <div className="qr-header-icon-box">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </div>
                <div>
                  <h3 className="qr-modal-title">Medication QR Code</h3>
                  <p className="qr-modal-subtitle">
                    {qrModalMed.med_name} {qrModalMed.med_type ? `· ${qrModalMed.med_type}` : ''} {qrModalMed.med_group ? `(${qrModalMed.med_group})` : ''}
                  </p>
                </div>
              </div>
              <button className="qr-modal-close" onClick={() => setShowQrModal(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="qr-modal-body">
              {/* QR Preview Card */}
              <div className="qr-preview-card">
                <div className="qr-image-wrapper">
                  {qrLoading ? (
                    <div className="qr-loading-spinner-box">
                      <div className="qr-spinner"></div>
                      <span>Generating QR Code...</span>
                    </div>
                  ) : qrDataUrl ? (
                    <img src={qrDataUrl} alt={`QR Code for ${qrModalMed.med_name}`} className="qr-preview-image" />
                  ) : (
                    <div className="qr-placeholder">No QR Code Available</div>
                  )}
                </div>
                <div className="qr-scan-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 18h.01" />
                    <path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                  </svg>
                  <span>สแกนด้วยกล้องมือถือเพื่อเปิดไฟล์ PDF โดยตรง (Direct PDF Link)</span>
                </div>
              </div>

              {/* Deep Link URL Box */}
              <div className="qr-url-card">
                <label className="qr-url-label">Direct PDF URL (ลิงก์ตรงสำหรับเปิดเอกสาร PDF)</label>
                <div className="qr-url-row">
                  <input
                    type="text"
                    readOnly
                    value={qrModalMed.qr_code_url || getDirectPdfUrl(qrModalMed.id)}
                    className="qr-url-input"
                  />
                  <button
                    className={`qr-btn-copy ${qrCopied ? 'copied' : ''}`}
                    onClick={handleCopyQrLink}
                  >
                    {qrCopied ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Action Buttons Grid */}
              <div className="qr-actions-section">
                <div className="qr-actions-label">Download & Export Options</div>
                <div className="qr-actions-grid">
                  {/* PNG Download */}
                  <button
                    className="qr-action-btn primary"
                    onClick={() => downloadQRCodeFile(qrDataUrl, `${qrModalMed.med_name}_QR`, 'png')}
                    disabled={!qrDataUrl || qrLoading}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download PNG (High-Res)</span>
                  </button>

                  {/* SVG Download */}
                  <button
                    className="qr-action-btn secondary"
                    onClick={() => downloadQRCodeFile(qrSvgString, `${qrModalMed.med_name}_QR`, 'svg')}
                    disabled={!qrSvgString || qrLoading}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    <span>Download SVG (Vector)</span>
                  </button>

                  {/* Open Direct PDF File */}
                  <a
                    className="qr-action-btn view-scan"
                    href={qrModalMed.qr_code_url || getDirectPdfUrl(qrModalMed.id)}
                    target="_blank"
                    rel="noreferrer"
                    title="เปิดไฟล์เอกสารฉลากยา PDF โดยตรง"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>เปิดไฟล์ PDF โดยตรง</span>
                  </a>

                  {/* Packaging Sticker Print (Admin, Pharmacist, Staff) */}
                  {currentUser && !currentUser.isGuest && (
                    <button
                      className="qr-action-btn print"
                      onClick={() => printPackagingSticker(qrModalMed, qrDataUrl)}
                      disabled={!qrDataUrl || qrLoading}
                      title="Print standard 80x52mm packaging sticker"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 6 2 18 2 18 9" />
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                        <rect x="6" y="14" width="12" height="8" />
                      </svg>
                      <span>Print Packaging Sticker</span>
                    </button>
                  )}

                  {/* Regenerate QR Code (Authorized users only) */}
                  {currentUser && !currentUser.isGuest && canEditLabel(currentUser, qrModalMed) && (
                    <button
                      className="qr-action-btn regen"
                      onClick={handleRegenerateQR}
                      disabled={qrLoading}
                      title="Regenerate QR Code and re-upload to Supabase"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={qrLoading ? 'spin-icon' : ''}>
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      <span>{qrLoading ? 'Regenerating...' : 'Regenerate QR Code'}</span>
                    </button>
                  )}
                </div>

                {qrRegenSuccess && (
                  <div className="qr-success-banner">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span>QR Code regenerated and saved to database successfully!</span>
                  </div>
                )}
              </div>

              <div className="qr-modal-footer-note">
                {currentUser?.isGuest ? (
                  <span>Guest Visitor Mode · Read-Only Access · Direct Leaflet Scanning Enabled</span>
                ) : (
                  <span>Ready for packaging distribution · Formatted for clinical pharmaceutical label stickers</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App