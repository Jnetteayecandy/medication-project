import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { withTimeout } from '../utils/medicationStore'
import { normalizeThaiText } from '../utils/documentImport'
import './ImportDocumentModal.css'

/**
 * AI-generate a PIL draft for a medicine (optionally a specific manufacturer's product).
 * Step 1: the user must acknowledge that AI content may contain errors.
 * Step 2: review / edit the draft, check the sources, then open it in the editor,
 *         where a pharmacist must approve it before it can be saved.
 */
export default function AiGenerateModal({ currentUser, topics, onClose, onUseDraft }) {
  const [step, setStep] = useState('form') // 'form' | 'generating' | 'review'
  const [consent, setConsent] = useState(false)
  const [request, setRequest] = useState({ med_name: '', strength: '', dosage_form: '', company: '', notes: '', use_web_search: true })
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)

  const set = (key) => (e) => setRequest(r => ({ ...r, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const generate = async () => {
    if (!consent || !request.med_name.trim()) return
    setError(null)
    setStep('generating')
    try {
      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke('generate-pil', {
          body: { ...request, user_id: currentUser?.id }
        }),
        240000,
        'AI generation'
      )
      if (fnError) {
        // Edge Function errors carry the JSON body in fnError.context
        let message = fnError.message
        try {
          const body = await fnError.context?.json?.()
          if (body?.error) message = body.error
        } catch { /* keep default message */ }
        if (/Failed to send a request|not found|404/i.test(message)) {
          message = 'The AI service is not set up yet. Ask the administrator to deploy the "generate-pil" Edge Function and set the ANTHROPIC_API_KEY secret.'
        }
        throw new Error(message)
      }
      if (!data?.contents) throw new Error(data?.error || 'The AI did not return a leaflet.')
      setDraft({
        med_name: normalizeThaiText(data.med_name || request.med_name),
        med_type: normalizeThaiText(data.med_type || request.dosage_form),
        contents: (data.contents || []).map(c => normalizeThaiText(c || '')),
        sources: data.sources || [],
        caveats: data.caveats || []
      })
      setStep('review')
    } catch (err) {
      setError(err?.message || String(err))
      setStep('form')
    }
  }

  const setContent = (i, value) => setDraft(d => {
    const contents = [...d.contents]
    contents[i] = value
    return { ...d, contents }
  })

  return (
    <div className="idm-backdrop" onClick={step === 'generating' ? undefined : onClose}>
      <div className="idm-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="AI Generate PIL">
        <div className="idm-head">
          <div>
            <h3 className="idm-title">AI Generate PIL</h3>
            <p className="idm-sub">Draft a patient leaflet with AI, then review and approve it</p>
          </div>
          {step !== 'generating' && <button className="idm-close" onClick={onClose} aria-label="Close">✕</button>}
        </div>

        {step === 'form' && (
          <>
            <div className="idm-form">
              <label className="idm-field">
                <span>Medication name *</span>
                <input value={request.med_name} onChange={set('med_name')} placeholder="e.g. Captopril / แคปโทพริล" autoFocus />
              </label>
              <div className="idm-row">
                <label className="idm-field">
                  <span>Strength</span>
                  <input value={request.strength} onChange={set('strength')} placeholder="e.g. 25 mg" />
                </label>
                <label className="idm-field">
                  <span>Dosage form</span>
                  <input value={request.dosage_form} onChange={set('dosage_form')} placeholder="e.g. Tablet / ชนิดเม็ด" />
                </label>
              </div>
              <label className="idm-field">
                <span>Manufacturer / company</span>
                <input value={request.company} onChange={set('company')} placeholder="e.g. Berlin Pharmaceutical Industry" />
              </label>
              <label className="idm-field">
                <span>Notes for the AI (optional)</span>
                <textarea rows={2} value={request.notes} onChange={set('notes')} placeholder="e.g. focus on use in hypertension; patients are elderly" />
              </label>
              <label className="idm-check">
                <input type="checkbox" checked={request.use_web_search} onChange={set('use_web_search')} />
                <span>Search the web for this product&apos;s official leaflet / product information</span>
              </label>
            </div>

            <label className={`idm-consent ${consent ? 'checked' : ''}`}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                I understand that this content is <strong>generated by AI and may contain errors</strong>.
                I will review every section against reliable sources before approving it.
              </span>
            </label>

            {error && <div className="idm-error">{error}</div>}

            <div className="idm-actions">
              <button className="idm-btn" onClick={onClose}>Cancel</button>
              <button
                className="idm-btn primary"
                onClick={generate}
                disabled={!consent || !request.med_name.trim()}
                title={!consent ? 'Please tick the acknowledgement first' : 'Generate a draft'}
              >
                Generate Draft
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <div className="idm-reading">
            <div className="idm-spinner" />
            <div className="idm-file">Generating a leaflet for “{request.med_name}”…</div>
            <div className="idm-stage">
              {request.use_web_search ? 'Searching for product information and writing the draft' : 'Writing the draft'} — this usually takes 1–2 minutes.
            </div>
          </div>
        )}

        {step === 'review' && draft && (
          <>
            <div className="idm-banner warn">
              AI-generated draft — check every section carefully. You will be asked to approve it before saving.
            </div>

            {draft.caveats.length > 0 && (
              <div className="idm-caveats">
                <strong>Please verify:</strong>
                <ul>{draft.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}

            <div className="idm-form">
              <label className="idm-field">
                <span>Medication name</span>
                <input value={draft.med_name} onChange={(e) => setDraft(d => ({ ...d, med_name: e.target.value }))} />
              </label>
              <label className="idm-field">
                <span>Dosage form</span>
                <input value={draft.med_type} onChange={(e) => setDraft(d => ({ ...d, med_type: e.target.value }))} />
              </label>
              {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <label key={i} className="idm-field">
                  <span>{topics[i] || `Section ${i}`}</span>
                  <textarea rows={Math.min(10, Math.max(3, (draft.contents[i] || '').split('\n').length))}
                    value={draft.contents[i] || ''} onChange={(e) => setContent(i, e.target.value)} />
                </label>
              ))}
            </div>

            <div className="idm-sources">
              <strong>Sources used by the AI</strong>
              {draft.sources.length > 0 ? (
                <ul>
                  {draft.sources.map((s, i) => (
                    <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>
                  ))}
                </ul>
              ) : (
                <p>No web sources — the draft is based on general product knowledge only.</p>
              )}
            </div>

            <div className="idm-actions">
              <button className="idm-btn" onClick={() => setStep('form')}>Back</button>
              <button className="idm-btn primary" onClick={() => onUseDraft(draft)}>Open in Editor</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
