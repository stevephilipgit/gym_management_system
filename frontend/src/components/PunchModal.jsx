/**
 * PunchModal.jsx - Reusable modal for attendance punch results
 * Displays check-in/check-out/late/error/closed states with member info
 */

export default function PunchModal({
  showModal,
  modalData,
  modalType,
  modalError,
  autoCloseCountdown,
  onClose,
}) {
  if (!showModal) return null;

  const getStatusColor = (daysLeft) => {
    if (daysLeft > 7) return '#22c55e';
    if (daysLeft > 0) return '#eab308';
    if (daysLeft === 0) return '#f97316';
    return '#ef4444';
  };

  const getStatusText = (daysLeft) => {
    if (daysLeft > 0) return `Active (${daysLeft}d)`;
    if (daysLeft === 0) return 'Last Day';
    return 'Expired';
  };

  const getModalHeaderColor = () => {
    switch (modalType) {
      case 'checkin': return '#22c55e';
      case 'checkout': return '#3b82f6';
      case 'late': return '#f97316';
      case 'closed': return '#ef4444';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getModalTitle = () => {
    switch (modalType) {
      case 'checkin': return '✅ Check-in Successful';
      case 'checkout': return '👋 Check-out Successful';
      case 'late': return '⚠️ Late Entry Recorded';
      case 'closed': return '🚫 Gym Closed';
      case 'error': return '❌ Error';
      default: return '';
    }
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}
        onClick={onClose}
      >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '420px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
          animation: 'fadeInUp 0.3s ease-out',
          margin: '0 16px',
        }}
      >
        {/* Header bar */}
        <div style={{
          backgroundColor: getModalHeaderColor(),
          padding: '20px 24px',
          color: 'white',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              {getModalTitle()}
            </h3>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
          {/* Auto-close countdown */}
          <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.85 }}>
            Auto-closing in {autoCloseCountdown}s
            <div style={{
              marginTop: '4px',
              height: '3px',
              backgroundColor: 'rgba(255,255,255,0.3)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                backgroundColor: 'white',
                width: `${(autoCloseCountdown / 5) * 100}%`,
                transition: 'width 1s linear',
                borderRadius: '2px',
              }} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {/* Error state */}
          {modalType === 'error' && (
            <div style={{
              padding: '16px',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '14px',
              textAlign: 'center',
            }}>
              {modalError}
            </div>
          )}

          {/* Gym Closed */}
          {modalType === 'closed' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏢</div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
                {modalData?.message || 'Gym is currently closed'}
              </p>
              <p style={{ fontSize: '13px', color: '#6b7280' }}>
                Hours: {modalData?.openingTime || '04:00'} — {modalData?.closingTime || '22:00'}
              </p>
            </div>
          )}

          {/* Check-in / Check-out / Late */}
          {(modalType === 'checkin' || modalType === 'checkout' || modalType === 'late') && modalData && (
            <div>
              {/* Time display */}
              <div style={{
                textAlign: 'center',
                marginBottom: '20px',
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '10px',
              }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#111827', letterSpacing: '1px' }}>
                  {modalType === 'checkout'
                    ? modalData.display?.checkOutTime
                    : modalData.display?.checkInTime
                  }
                </div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: getModalHeaderColor(),
                  textTransform: 'uppercase',
                  marginTop: '4px',
                  letterSpacing: '1px',
                }}>
                  {modalData.display?.statusLabel}
                </div>
              </div>

              {/* Member details grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '14px',
              }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827', marginTop: '2px' }}>{modalData.member?.name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member ID</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#3b82f6', marginTop: '2px' }}>#{modalData.member?.gymId}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginTop: '2px' }}>{modalData.member?.phone}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Plan</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginTop: '2px' }}>{modalData.member?.plan}</div>
                </div>
              </div>

              {/* Status + Expiry */}
              <div style={{
                marginTop: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: '#f9fafb',
              }}>
                <span style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  color: getStatusColor(modalData.member?.daysLeft),
                }}>
                  {getStatusText(modalData.member?.daysLeft)}
                </span>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  Expires: {modalData.member?.validityEnd}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Animation keyframe */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}
