import { useState, useEffect } from 'react'
import './GuidedTour.css'

const TOUR_STEPS = [
  {
    step: 1,
    type: 'center',
    title: 'Welcome to PIL System',
    content: 'This system helps you create and manage 3-fold Patient Information Leaflets (PIL) with instant PDF export. Let\'s take a brief tour of key features.',
    targetSelector: null,
    nextLabel: 'Next'
  },
  {
    step: 2,
    type: 'spotlight',
    targetSelector: '.card-create-new',
    title: 'Start Here — Create New Document',
    content: 'Click here to enter a medication name and open the leaflet editor workspace.',
    nextLabel: 'Next'
  },
  {
    step: 3,
    type: 'spotlight',
    targetSelector: '.card-manage-data',
    title: 'Manage Data Library',
    content: 'Add or update medications, standard phrases for each leaflet section, and reusable footer information.',
    nextLabel: 'Next'
  },
  {
    step: 4,
    type: 'center',
    title: 'Connect Google Account (Optional)',
    content: 'Link your Google account to sign in with a single click without entering your password.',
    targetSelector: null,
    nextLabel: 'Next'
  },
  {
    step: 5,
    type: 'center',
    title: 'You are all set',
    content: 'You can reopen this tour at any time by clicking the "?" button at the bottom right. Step-by-step guidance is also available in the editor.',
    targetSelector: null,
    nextLabel: 'Got it'
  }
]

export default function GuidedTour({ step = 1, setStep, onClose }) {
  const [targetRect, setTargetRect] = useState(null)
  const currentStepData = TOUR_STEPS.find(s => s.step === step) || TOUR_STEPS[0]

  useEffect(() => {
    const updateTargetRect = () => {
      if (currentStepData.targetSelector) {
        const el = document.querySelector(currentStepData.targetSelector)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          const rect = el.getBoundingClientRect()
          const computedStyle = window.getComputedStyle(el)
          const radius = parseFloat(computedStyle.borderTopLeftRadius) || 16
          setTargetRect({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            bottom: rect.bottom,
            right: rect.right,
            borderRadius: radius
          })
          return
        }
      }
      setTargetRect(null)
    }

    const timer1 = setTimeout(updateTargetRect, 60)
    const timer2 = setTimeout(updateTargetRect, 320)
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect)
    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect)
    }
  }, [currentStepData, step])

  const handleNext = () => {
    if (step < TOUR_STEPS.length) {
      setStep(step + 1)
    } else {
      if (onClose) onClose()
    }
  }

  const handlePrev = () => {
    if (step > 1) {
      setStep(step - 1)
    }
  }

  // Calculate popover position for spotlight mode
  let popoverStyle = {}
  if (currentStepData.type === 'spotlight' && targetRect) {
    const popoverWidth = Math.min(380, window.innerWidth - 32)
    let top = targetRect.bottom + 16
    let left = targetRect.left + (targetRect.width / 2) - (popoverWidth / 2)

    // Keep within window horizontal bounds
    left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left))

    // If popover goes off bottom of screen, show above target instead
    if (top + 180 > window.innerHeight && targetRect.top > 200) {
      top = targetRect.top - 180 - 16
    }

    popoverStyle = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${popoverWidth}px`,
      zIndex: 100000
    }
  }

  return (
    <div className="tour-overlay-container">
      {/* Background Dimming Layer */}
      {currentStepData.type === 'spotlight' && targetRect ? (
        <svg
          className="tour-svg-backdrop"
          onClick={onClose}
          aria-hidden="true"
        >
          <defs>
            <mask id="tour-spotlight-mask">
              {/* White background: area to be dimmed */}
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {/* Black cutout: target element remains 100% visible and unblurred with exact card dimensions */}
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx={targetRect.borderRadius || 16}
                ry={targetRect.borderRadius || 16}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(15, 23, 42, 0.72)"
            mask="url(#tour-spotlight-mask)"
            style={{ cursor: 'pointer' }}
          />
        </svg>
      ) : (
        <div className="tour-backdrop" onClick={onClose} />
      )}

      {/* Spotlight cutout border & glow around target element - exactly fitted */}
      {currentStepData.type === 'spotlight' && targetRect && (
        <div
          className="tour-spotlight-glow"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
            borderRadius: `${targetRect.borderRadius || 16}px`
          }}
        />
      )}

      {/* Tour Dialog / Popover */}
      <div
        className={`tour-dialog ${currentStepData.type === 'center' ? 'tour-dialog-center' : 'tour-dialog-popover'}`}
        style={popoverStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          className="tour-close-btn"
          onClick={onClose}
          title="Close tour"
          aria-label="Close tour"
        >
          ✕
        </button>

        {/* Content Area */}
        <div className="tour-body">
          <h3 className="tour-title">{currentStepData.title}</h3>
          <p className="tour-content">{currentStepData.content}</p>
        </div>

        {/* Footer Navigation Bar */}
        <div className="tour-footer">
          {/* Step Indicator (5 Dots) */}
          <div className="tour-dots">
            {TOUR_STEPS.map((s) => (
              <span
                key={s.step}
                className={`tour-dot ${s.step === step ? 'active' : ''}`}
                onClick={() => setStep(s.step)}
                title={`Step ${s.step}`}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="tour-btn-group">
            {step > 1 && (
              <button
                type="button"
                className="tour-btn-prev"
                onClick={handlePrev}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className={`tour-btn-next ${step === TOUR_STEPS.length ? 'finish' : ''}`}
              onClick={handleNext}
            >
              {currentStepData.nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
