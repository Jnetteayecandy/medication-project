import { useState } from 'react'
import AdminUserList from './AdminUserList'
import AdminUserDetail from './AdminUserDetail'
import DedicatedPdfView from './DedicatedPdfView'
import './UserActivityPanel.css'

/**
 * User work & activity history page
 * - mode 'admin': Admin sees every user → click through to each user's details
 * - mode 'self' : regular users see only their own work
 */
export default function UserActivityPanel({ currentUser, mode = 'admin', onBack, topics }) {
  const isSelf = mode === 'self'
  const [selectedUser, setSelectedUser] = useState(null)
  const [openLabel, setOpenLabel] = useState(null)

  // Open the PIL document with the existing PIL view (read-only)
  if (openLabel) {
    return (
      <DedicatedPdfView
        drug={openLabel}
        loading={false}
        error={null}
        onBackToHome={() => setOpenLabel(null)}
        topics={topics}
      />
    )
  }

  const selfProfile = isSelf && currentUser ? {
    id: currentUser.id,
    name: currentUser.name,
    email: currentUser.email,
    role: currentUser.role,
    position: currentUser.position,
    organization: currentUser.organization
  } : null

  const detailUser = selfProfile || selectedUser
  const title = isSelf ? 'My Work' : (selectedUser ? 'User Details' : 'User Management (Admin)')
  const subtitle = isSelf
    ? 'Labels you created and your activity history'
    : (selectedUser ? 'Labels created and full activity history' : 'See what each user has done in the system')

  const handleBack = () => {
    if (!isSelf && selectedUser) setSelectedUser(null)
    else onBack()
  }

  return (
    <div className="uap-page">
      <header className="uap-header">
        <button className="uap-back-btn" onClick={handleBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <span>{!isSelf && selectedUser ? 'Back to users' : 'Back to dashboard'}</span>
        </button>
        <div className="uap-header-text">
          <h1 className="uap-title">{title}</h1>
          <p className="uap-subtitle">{subtitle}</p>
        </div>
      </header>

      <main className="uap-main">
        {detailUser ? (
          <AdminUserDetail
            key={detailUser.id}
            user={detailUser}
            topics={topics}
            isSelf={isSelf}
            onOpenLabel={setOpenLabel}
          />
        ) : (
          <AdminUserList onSelectUser={setSelectedUser} />
        )}
      </main>
    </div>
  )
}
