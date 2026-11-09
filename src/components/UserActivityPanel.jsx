import { useState } from 'react'
import AdminUserList from './AdminUserList'
import AdminUserDetail from './AdminUserDetail'
import DedicatedPdfView from './DedicatedPdfView'
import './UserActivityPanel.css'

/**
 * หน้าดูผลงานและประวัติการทำงานของผู้ใช้
 * - mode 'admin': Admin เห็นรายชื่อผู้ใช้ทุกคน → กดเข้าไปดูรายละเอียดแต่ละคน
 * - mode 'self' : ผู้ใช้ทั่วไปเห็นเฉพาะผลงานของตัวเอง
 */
export default function UserActivityPanel({ currentUser, mode = 'admin', onBack, topics }) {
  const isSelf = mode === 'self'
  const [selectedUser, setSelectedUser] = useState(null)
  const [openLabel, setOpenLabel] = useState(null)

  // เปิดเอกสาร PIL ด้วยหน้าเดิมของระบบ (อ่านอย่างเดียว)
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
  const title = isSelf ? 'ผลงานของฉัน' : (selectedUser ? 'รายละเอียดผู้ใช้' : 'จัดการผู้ใช้ (Admin)')
  const subtitle = isSelf
    ? 'ฉลากยาที่คุณสร้าง และประวัติการทำงานของคุณ'
    : (selectedUser ? 'ฉลากยาที่สร้างและประวัติการทำงานทั้งหมด' : 'ดูว่าผู้ใช้แต่ละคนทำอะไรไปบ้างในระบบ')

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
          <span>{!isSelf && selectedUser ? 'กลับไปรายชื่อผู้ใช้' : 'กลับหน้าหลัก'}</span>
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
