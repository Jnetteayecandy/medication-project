import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPTED_IMPORT_TYPES, extractTextFromFile, parsePilText } from '../utils/documentImport'
import './ImportDocumentModal.css'

/**
 * Import an image, PDF or Word file, read its text (OCR for images / scanned PDFs),
 * let the user review and edit the detected fields, then open it in the editor.
 */
export default function ImportDocumentModal({ topics, onClose, onImport }) {
  const [step, setStep] = useState('pick') // 'pick' | 'reading' | 'review'
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState({ stage: '', progress: 0 })
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [rawText, setRawText] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [form, setForm] = useState({ med_name: '', med_type: '', contents: Array(8).fill('') })
  const [foundSections, setFoundSections] = useState(0)
  const inputRef = useRef(null)

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError(null)
    setFileName(file.name || 'Pasted image')
    setPreview(file.type?.startsWith('image/') ? URL.createObjectURL(file) : null)
    setStep('reading')
    setProgress({ stage: 'Starting', progress: 0 })
    try {
      const text = await extractTextFromFile(file, setProgress)
      if (!text.trim()) throw new Error('No text could be found in this file. Try a clearer image or a different file.')
      const parsed = parsePilText(text)
      setRawText(text)
      setForm({ med_name: parsed.med_name, med_type: parsed.med_type, contents: parsed.contents })
      setFoundSections(parsed.foundSections)
      setStep('review')
    } catch (err) {
      console.error('Import error:', err)
      setError(err?.message || String(err))
      setStep('pick')
    }
  }, [])

  // Paste an image (Ctrl/Cmd + V) anywhere while the picker is open
  useEffect(() => {
    if (step !== 'pick') return
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.kind === 'file')
      if (item) {
        e.preventDefault()
        handleFile(item.getAsFile())
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [step, handleFile])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const setContent = (i, value) => setForm(f => {
    const contents = [...f.contents]
    contents[i] = value
    return { ...f, contents }
  })

  return (
    <div className="idm-backdrop" onClick={step === 'reading' ? undefined : onClose}>
      <div className="idm-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Import document">
        <div className="idm-head">
          <div>
            <h3 className="idm-title">Import Document</h3>
            <p className="idm-sub">Image, PDF or Word file → editable medication label</p>
          </div>
          {step !== 'reading' && <button className="idm-close" onClick={onClose} aria-label="Close">✕</button>}
        </div>

        {step === 'pick' && (
          <>
            <div
              className={`idm-drop ${dragOver ? 'over' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <strong>Drop a file here, or click to choose</strong>
              <span>You can also paste an image with Ctrl/Cmd + V</span>
              <span className="idm-types">PNG · JPG · PDF · Word (.docx)</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_IMPORT_TYPES}
              hidden
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
            />
            {error && <div className="idm-error">{error}</div>}
            <p className="idm-note">
              Text in images and scanned PDFs is read automatically (Thai + English). The first time can take
              a little longer while the reader downloads. You can review and fix everything before saving.
            </p>
          </>
        )}

        {step === 'reading' && (
          <div className="idm-reading">
            {preview && <img src={preview} alt="" className="idm-thumb" />}
            <div className="idm-file">{fileName}</div>
            <div className="idm-stage">{progress.stage || 'Working'}…</div>
            <div className="idm-bar"><div style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }} /></div>
          </div>
        )}

        {step === 'review' && (
          <>
            <div className={`idm-banner ${foundSections ? 'ok' : 'warn'}`}>
              {foundSections
                ? `Found ${foundSections} of 7 sections in “${fileName}”. Check the text below, then open it in the editor.`
                : `Section headings were not recognised in “${fileName}”, so all text was put in section 1. You can move it in the editor.`}
            </div>

            <div className="idm-form">
              <label className="idm-field">
                <span>Medication name</span>
                <input value={form.med_name} onChange={(e) => setForm(f => ({ ...f, med_name: e.target.value }))} />
              </label>
              <label className="idm-field">
                <span>Dosage form</span>
                <input value={form.med_type} onChange={(e) => setForm(f => ({ ...f, med_type: e.target.value }))} />
              </label>
              {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <label key={i} className="idm-field">
                  <span>{topics[i] || `Section ${i}`}</span>
                  <textarea rows={Math.min(8, Math.max(2, (form.contents[i] || '').split('\n').length))}
                    value={form.contents[i] || ''} onChange={(e) => setContent(i, e.target.value)} />
                </label>
              ))}
            </div>

            <button className="idm-link" onClick={() => setShowRaw(v => !v)}>
              {showRaw ? 'Hide extracted text' : 'Show all extracted text'}
            </button>
            {showRaw && <pre className="idm-raw">{rawText}</pre>}

            <div className="idm-actions">
              <button className="idm-btn" onClick={() => { setStep('pick'); setError(null) }}>Choose another file</button>
              <button className="idm-btn primary" onClick={() => onImport(form)}>Open in Editor</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
