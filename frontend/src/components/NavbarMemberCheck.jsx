import { useState, useRef, useEffect, useCallback } from 'react';
import apiClient from '../utils/apiClient';
import PunchModal from './PunchModal';

/**
 * Sanitize input: trim, strip dangerous characters
 */
function sanitizeInput(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/[<>'"`;\\\/\{\}\[\]\(\)&$!|]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Validate input for search: Gym ID or Phone
 * Returns { valid, error, type }
 */
function validateInput(input) {
  const clean = sanitizeInput(input);
  if (!clean) return { valid: false, error: 'Enter Gym ID or Phone Number' };

  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length !== clean.length) {
    return { valid: false, error: 'Only numbers allowed' };
  }

  // Phone: exactly 10 digits, starts with 6-9
  if (/^[6-9]\d{9}$/.test(digitsOnly)) {
    return { valid: true, error: null, type: 'phone' };
  }

  // Reject >10 digits
  if (digitsOnly.length > 10) {
    return { valid: false, error: 'Phone must be exactly 10 digits' };
  }

  // If 10 digits but doesn't start with 6-9
  if (digitsOnly.length === 10) {
    return { valid: false, error: 'Phone must start with 6, 7, 8, or 9' };
  }

  // Gym ID: positive integer (min 1 digit, spec says min 4 but gymId like 4 should work)
  if (digitsOnly.length >= 1) {
    const num = parseInt(digitsOnly, 10);
    if (num <= 0) return { valid: false, error: 'Gym ID must be positive' };
    return { valid: true, error: null, type: 'gymId' };
  }

  return { valid: false, error: 'Invalid input' };
}

export default function NavbarMemberCheck() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalType, setModalType] = useState(''); // 'checkin' | 'checkout' | 'late' | 'closed' | 'error'
  const [autoCloseCountdown, setAutoCloseCountdown] = useState(5);
  
  const autoCloseTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const inputRef = useRef(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(autoCloseTimerRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setModalData(null);
    setModalError('');
    setModalType('');
    setAutoCloseCountdown(5);
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
  }, []);

  const startAutoClose = useCallback(() => {
    // Clear any previous timers
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    
    setAutoCloseCountdown(5);
    
    // Countdown interval
    countdownIntervalRef.current = setInterval(() => {
      setAutoCloseCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // Auto-close after 5 seconds
    autoCloseTimerRef.current = setTimeout(() => {
      closeModal();
    }, 5000);
  }, [closeModal]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    // Only allow digits
    const digitsOnly = val.replace(/\D/g, '');
    setInput(digitsOnly);
    setValidationError('');
  };

  const handleSearch = async (e) => {
    e.preventDefault();

    // Validate
    const { valid, error } = validateInput(input);
    if (!valid) {
      setValidationError(error);
      return;
    }

    setLoading(true);
    setValidationError('');

    try {
      const response = await apiClient.post('/attendance/search-punch', {
        input: sanitizeInput(input),
      });

      const data = response.data;

      if (data.success) {
        // Determine modal type
        if (data.isLate) {
          setModalType('late');
        } else if (data.isCheckOut) {
          setModalType('checkout');
        } else {
          setModalType('checkin');
        }
        setModalData(data);
        setModalError('');
        setShowModal(true);
        startAutoClose();
        setInput('');
      }
    } catch (err) {
      const errData = err.response?.data;

      if (errData?.gymClosed) {
        setModalType('closed');
        setModalData(errData);
        setModalError('');
        setShowModal(true);
        startAutoClose();
      } else {
        setModalType('error');
        setModalError(errData?.message || 'Something went wrong');
        setModalData(null);
        setShowModal(true);
        startAutoClose();
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };



  return (
    <>
      <div style={{ position: 'relative' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              placeholder="Gym ID or Phone"
              value={input}
              onChange={handleInputChange}
              maxLength={10}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white w-40 sm:w-48 lg:w-56"
              aria-label="Search member by Gym ID or Phone number"
              id="header-search-input"
              autoComplete="off"
            />
            {validationError && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '4px',
                padding: '6px 10px',
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                fontSize: '12px',
                borderRadius: '6px',
                fontWeight: 600,
                zIndex: 60,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}>
                {validationError}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !input}
            className="px-3 sm:px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-semibold transition whitespace-nowrap"
            aria-label="Search and punch attendance"
            id="header-search-btn"
          >
            {loading ? '...' : 'Punch'}
          </button>
        </form>
      </div>

      {/* Modal - now extracted to separate component */}
      <PunchModal
        showModal={showModal}
        modalData={modalData}
        modalType={modalType}
        modalError={modalError}
        autoCloseCountdown={autoCloseCountdown}
        onClose={closeModal}
      />
    </>
  );
}
