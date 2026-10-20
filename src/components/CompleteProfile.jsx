import { useState } from 'react'
import { supabase } from '../supabaseClient'
import './CompleteProfile.css'

export default function CompleteProfile({ currentUser, onProfileCompleted, onLogout }) {
  const [fullName, setFullName] = useState(currentUser?.name || '')
  const [emailAddress, setEmailAddress] = useState(currentUser?.email || '')
  const [phoneNumber, setPhoneNumber] = useState(currentUser?.phone || '')
  const [organization, setOrganization] = useState(currentUser?.organization || '')
  const [position, setPosition] = useState(currentUser?.position || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  // Generate 2 initials for avatar
  const getInitials = () => {
    const raw = (currentUser?.name || currentUser?.username || currentUser?.email || 'US').trim()
    const parts = raw.split(/\s+/)
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return raw.slice(0, 2).toUpperCase()
  }

  // Format joined date (e.g. 28 August 2026)
  const getJoinedDate = () => {
    try {
      const date = currentUser?.created_at ? new Date(currentUser.created_at) : new Date()
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    } catch {
      return 'Today'
    }
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    if (savingProfile) return

    if (!fullName.trim()) {
      alert('Please enter your full name.')
      return
    }
    if (!emailAddress.trim()) {
      alert('Please enter your email address.')
      return
    }
    if (!phoneNumber.trim()) {
      alert('Please enter your phone number.')
      return
    }
    if (!organization.trim()) {
      alert('Please enter your organization or hospital.')
      return
    }
    if (!position.trim()) {
      alert('Please enter your position.')
      return
    }

    setSavingProfile(true)
    try {
      const payload = {
        name: fullName.trim(),
        email: emailAddress.trim(),
        phone: phoneNumber.trim(),
        organization: organization.trim(),
        position: position.trim(),
        has_completed_profile: true
      }

      // 1. Update public.profiles in Supabase
      if (currentUser?.id) {
        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', currentUser.id)

        if (error) {
          // Fallback if some schema columns are missing in custom profiles table
          console.warn('Full update warning, attempting essential columns fallback:', error)
          const fallbackPayload = {
            name: fullName.trim(),
            email: emailAddress.trim()
          }
          await supabase
            .from('profiles')
            .update(fallbackPayload)
            .eq('id', currentUser.id)
        }
      }

      // 2. Persist locally as fallback so user is never blocked
      if (currentUser?.id && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`pil_profile_${currentUser.id}`, 'true')
        } catch { /* ignore */ }
      }

      // 3. Notify parent app
      if (onProfileCompleted) {
        onProfileCompleted(payload)
      }
    } catch (err) {
      console.error('Error saving profile:', err)
      alert('Unable to save profile: ' + (err.message || err))
    } finally {
      setSavingProfile(false)
    }
  }

  const initials = getInitials()
  const joinedDate = getJoinedDate()
  const displayUsername = currentUser?.username || currentUser?.name || currentUser?.email?.split('@')[0] || 'User'
  const displayEmail = currentUser?.email || `${displayUsername}@pil-system.local`

  return (
    <div className="setup-page-wrapper sarabun-font">
      {/* Top Header Navigation */}
      <header className="setup-top-header">
        <div className="setup-header-left">
          <div className="setup-header-logo-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="17" x2="12" y2="11"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </div>
          <div className="setup-header-brand-col">
            <span className="setup-header-brand-name">PIL System</span>
            <span className="setup-header-brand-sub">Patient Information Leaflet</span>
          </div>
        </div>

        <div className="setup-header-right">
          <div className="setup-user-menu-wrapper">
            <button
              className="setup-user-capsule"
              style={{ borderColor: currentUser?.badgeColor || '#2563eb' }}
              onClick={() => setShowDropdown(prev => !prev)}
              type="button"
              aria-label="User profile menu"
            >
              <div className="setup-avatar-circle" style={{ background: currentUser?.badgeBg || '#eff6ff', color: currentUser?.badgeColor || '#2563eb' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <div className="setup-text-column">
                <span className="setup-email-text">{displayEmail}</span>
                <span className="setup-role-subtext" style={{ color: currentUser?.badgeColor || '#2563eb' }}>
                  {currentUser?.role || 'STAFF'}
                </span>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#64748b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: showDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginLeft: '2px' }}
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {showDropdown && (
              <div className="setup-dropdown-menu">
                <div className="setup-dropdown-header">
                  <div className="setup-dropdown-username">{displayUsername}</div>
                  <div className="setup-dropdown-email">{displayEmail}</div>
                </div>
                <div className="setup-dropdown-divider" />
                <button
                  className="setup-dropdown-item logout-item"
                  onClick={() => {
                    setShowDropdown(false)
                    onLogout()
                  }}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="setup-main-container">
        {/* Eyebrow & Final Step Badge */}
        <div className="setup-eyebrow-row">
          <div className="setup-badge-tag">
            <span className="setup-dot"></span>
            <span>ACCOUNT SETUP</span>
          </div>
          <div className="setup-final-step-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Final step</span>
          </div>
        </div>

        {/* Heading & Subtitle */}
        <h1 className="setup-main-title">Complete your profile</h1>
        <p className="setup-main-subtitle">
          Tell us a little about yourself before entering your workspace.
        </p>

        {/* Warning Banner */}
        <div className="setup-alert-banner">
          <div className="setup-alert-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#f59e0b">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1.2" fill="#ffffff" />
            </svg>
          </div>
          <div className="setup-alert-text">
            <h4 className="setup-alert-title">Please complete all required information</h4>
            <p className="setup-alert-desc">
              These details help identify document owners and cannot be edited directly after saving. Contact your administrator if a change is needed later.
            </p>
          </div>
        </div>

        {/* White Form Card */}
        <div className="setup-card">
          {/* Top User Info Summary */}
          <div className="setup-user-preview">
            <div className="setup-avatar-box">
              {initials}
            </div>
            <div className="setup-user-details">
              <div className="setup-user-name-row">
                <span className="setup-user-username">{displayUsername}</span>
                <span className="setup-new-badge">New account</span>
              </div>
              <div className="setup-user-handle">@{displayUsername.toLowerCase().replace(/\s+/g, '')}</div>
              <div className="setup-user-meta-line">
                <span>
                  {currentUser?.role === 'ADMIN' ? 'Administrator' : currentUser?.role === 'PHARMACIST' ? 'Clinical Pharmacist' : 'Staff member'}
                </span>
                <span className="setup-meta-sep">•</span>
                <span>Joined {joinedDate}</span>
                <span className="setup-meta-sep">•</span>
                <span className="setup-google-badge">
                  <svg width="13" height="13" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Google connected</span>
                </span>
              </div>
            </div>
          </div>

          {/* Section Header: Personal information */}
          <div className="setup-section-header">
            <div className="setup-section-left">
              <div className="setup-section-icon-box">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <div className="setup-section-titles">
                <h3 className="setup-section-title">Personal information</h3>
                <p className="setup-section-sub">Required details for your PIL document workspace.</p>
              </div>
            </div>
            <span className="setup-required-indicator">* Required</span>
          </div>

          {/* Form Inputs */}
          <form onSubmit={handleSaveProfile} className="setup-form">
            {/* Full name */}
            <div className="setup-field-group">
              <label className="setup-field-label">Full name <span className="text-red">*</span></label>
              <input
                type="text"
                className="setup-field-input"
                placeholder="e.g. Dr. Somchai Jaidee"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={savingProfile}
              />
            </div>

            {/* Row 2: Email & Phone */}
            <div className="setup-field-row">
              <div className="setup-field-group">
                <label className="setup-field-label">Email address <span className="text-red">*</span></label>
                <input
                  type="email"
                  className="setup-field-input"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  required
                  disabled={savingProfile}
                />
              </div>
              <div className="setup-field-group">
                <label className="setup-field-label">Phone number <span className="text-red">*</span></label>
                <input
                  type="tel"
                  className="setup-field-input"
                  placeholder="0xx-xxx-xxxx"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                  disabled={savingProfile}
                />
              </div>
            </div>

            {/* Row 3: Organization & Position */}
            <div className="setup-field-row">
              <div className="setup-field-group">
                <label className="setup-field-label">Organization / Hospital <span className="text-red">*</span></label>
                <input
                  type="text"
                  className="setup-field-input"
                  placeholder="e.g. Songklanagarind Hospital"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  required
                  disabled={savingProfile}
                />
              </div>
              <div className="setup-field-group">
                <label className="setup-field-label">Position <span className="text-red">*</span></label>
                <input
                  type="text"
                  className="setup-field-input"
                  placeholder="e.g. Pharmacist"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  required
                  disabled={savingProfile}
                />
              </div>
            </div>

            {/* Card Action Bottom Bar */}
            <div className="setup-card-bottom">
              <span className="setup-disclaimer">
                Your information is used only for document attribution and account administration.
              </span>
              <button
                type="submit"
                className="setup-save-btn"
                disabled={savingProfile}
              >
                <span>{savingProfile ? 'Saving profile...' : 'Save & enter workspace'}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="setup-page-footer">
          <div className="setup-footer-pill">
            <span className="setup-footer-sub">Supported by</span>
            <span className="setup-footer-main">PSU · Prince of Songkla University</span>
          </div>
        </div>
      </main>
    </div>
  )
}
