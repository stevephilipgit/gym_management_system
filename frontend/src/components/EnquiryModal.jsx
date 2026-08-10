/**
 * EnquiryModal.jsx
 * Premium Join Now enquiry modal for Giri Gym.
 * Black + Gold theme, full validation, loading states.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import apiClient from '../utils/apiClient';

const BRANCHES = ['Mathur'];
const REASONS = [
  'Membership Plans',
  'Weight Loss',
  'Weight Gain',
  'Personal Training',
  'Transformation',
  'Pricing',
  'Branch Visit',
  'General Question',
  'Other',
];

const INITIAL_FORM = {
  name: '',
  email: '',
  phone: '',
  preferred_branch: '',
  reason: '',
  message: '',
  website: '', // honeypot
};

function sanitize(str) {
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validate(form) {
  const errors = {};

  const name = sanitize(form.name);
  if (!name) errors.name = 'Full name is required.';
  else if (name.length < 2) errors.name = 'Name must be at least 2 characters.';
  else if (name.length > 80) errors.name = 'Name must be under 80 characters.';
  else if (!/^[A-Za-z\s'.,-]+$/.test(name)) errors.name = 'Only letters and spaces allowed.';

  const email = form.email.trim();
  if (!email) errors.email = 'Email address is required.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';

  const phone = form.phone.replace(/\s+/g, '');
  if (!phone) errors.phone = 'Phone number is required.';
  else if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';

  if (!form.preferred_branch) errors.preferred_branch = 'Please select a branch.';
  if (!form.reason) errors.reason = 'Please select a reason.';

  const msg = sanitize(form.message);
  if (msg && msg.length < 5) errors.message = 'Message must be at least 5 characters.';
  if (msg && msg.length > 500) errors.message = 'Message must be under 500 characters.';

  return errors;
}

export default function EnquiryModal({ isOpen, onClose, initialReason = '', initialMessage = '' }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const firstInputRef = useRef(null);
  const modalRef = useRef(null);

  // Lock background scroll when open and prefill form context
  useEffect(() => {
    if (isOpen) {
      setForm({
        ...INITIAL_FORM,
        reason: initialReason || '',
        message: initialMessage || '',
      });
      setErrors({});
      setTouched({});
      setSubmitting(false);
      setSubmitted(false);
      setServerError('');
      setSuccessMsg('');
      document.body.style.overflow = 'hidden';
      setTimeout(() => firstInputRef.current?.focus(), 100);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen, initialReason, initialMessage]);

  // ESC key close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Auto-close after success
  useEffect(() => {
    if (submitted) {
      const t = setTimeout(() => {
        handleReset();
        onClose();
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [submitted, onClose]);

  // Click outside to close
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (touched[field]) {
      const errs = validate({ ...form, [field]: value });
      setErrors((prev) => ({ ...prev, [field]: errs[field] }));
    }
  };

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const errs = validate(form);
    setErrors((prev) => ({ ...prev, [field]: errs[field] }));
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setErrors({});
    setTouched({});
    setSubmitting(false);
    setSubmitted(false);
    setServerError('');
    setSuccessMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');

    // Mark all fields touched
    const allTouched = Object.keys(INITIAL_FORM).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);

    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const payload = {
        name: sanitize(form.name),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/\s+/g, ''),
        preferred_branch: form.preferred_branch,
        reason: form.reason,
        message: sanitize(form.message),
        source_page: 'home',
        website: form.website, // honeypot
      };

      const res = await apiClient.post('/enquiries', payload);
      setSuccessMsg(res.data?.message || 'Thank you! Our team will reach out to you shortly.');
      setSubmitted(true);
    } catch (err) {
      const msg = err.response?.data?.message;
      if (err.response?.status === 429) {
        setServerError('Too many submissions. Please try again in 10 minutes.');
      } else {
        setServerError(msg || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="enq-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enq-title"
    >
      <div className="enq-modal" ref={modalRef}>
        {/* Header */}
        <div className="enq-header">
          <div>
            <p className="enq-eyebrow">Premium Membership Enquiry</p>
            <h2 id="enq-title" className="enq-title">Join GIRI GYM</h2>
          </div>
          <button
            className="enq-close"
            onClick={onClose}
            aria-label="Close enquiry form"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="enq-body">
          {submitted ? (
            /* Success State */
            <div className="enq-success">
              <div className="enq-success-icon">✓</div>
              <h3 className="enq-success-title">{successMsg}</h3>
              <p className="enq-success-sub">This window will close automatically in a few seconds.</p>
              <button className="enq-btn-primary" onClick={() => { handleReset(); onClose(); }}>
                Close
              </button>
            </div>
          ) : (
            /* Form State */
            <form onSubmit={handleSubmit} noValidate autoComplete="off">
              <p className="enq-desc">
                Fill this form and our team will contact you shortly.
              </p>

              {/* Honeypot — hidden from humans */}
              <input
                type="text"
                name="website"
                value={form.website}
                onChange={(e) => handleChange('website', e.target.value)}
                style={{ display: 'none' }}
                tabIndex="-1"
                autoComplete="off"
              />

              {serverError && (
                <div className="enq-server-error" role="alert">{serverError}</div>
              )}

              <div className="enq-grid">
                {/* Full Name */}
                <div className="enq-field">
                  <label htmlFor="enq-name" className="enq-label">
                    Full Name <span className="enq-required">*</span>
                  </label>
                  <input
                    id="enq-name"
                    ref={firstInputRef}
                    type="text"
                    className={`enq-input ${errors.name && touched.name ? 'enq-input-error' : ''}`}
                    placeholder="e.g. Arjun Kumar"
                    value={form.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    onBlur={() => handleBlur('name')}
                    maxLength={80}
                    disabled={submitting}
                  />
                  {errors.name && touched.name && (
                    <span className="enq-error-msg" role="alert">{errors.name}</span>
                  )}
                </div>

                {/* Email */}
                <div className="enq-field">
                  <label htmlFor="enq-email" className="enq-label">
                    Email Address <span className="enq-required">*</span>
                  </label>
                  <input
                    id="enq-email"
                    type="email"
                    className={`enq-input ${errors.email && touched.email ? 'enq-input-error' : ''}`}
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    maxLength={120}
                    disabled={submitting}
                  />
                  {errors.email && touched.email && (
                    <span className="enq-error-msg" role="alert">{errors.email}</span>
                  )}
                </div>

                {/* Phone */}
                <div className="enq-field">
                  <label htmlFor="enq-phone" className="enq-label">
                    Contact Number <span className="enq-required">*</span>
                  </label>
                  <input
                    id="enq-phone"
                    type="tel"
                    className={`enq-input ${errors.phone && touched.phone ? 'enq-input-error' : ''}`}
                    placeholder="9876543210"
                    value={form.phone}
                    onChange={(e) => handleChange('phone', e.target.value.replace(/[^\d]/g, '').substring(0, 10))}
                    onBlur={() => handleBlur('phone')}
                    maxLength={10}
                    disabled={submitting}
                    inputMode="numeric"
                  />
                  {errors.phone && touched.phone && (
                    <span className="enq-error-msg" role="alert">{errors.phone}</span>
                  )}
                </div>

                {/* Preferred Branch */}
                <div className="enq-field">
                  <label htmlFor="enq-branch" className="enq-label">
                    Preferred Branch <span className="enq-required">*</span>
                  </label>
                  <select
                    id="enq-branch"
                    className={`enq-input enq-select ${errors.preferred_branch && touched.preferred_branch ? 'enq-input-error' : ''}`}
                    value={form.preferred_branch}
                    onChange={(e) => handleChange('preferred_branch', e.target.value)}
                    onBlur={() => handleBlur('preferred_branch')}
                    disabled={submitting}
                  >
                    <option value="">Select a branch</option>
                    {BRANCHES.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  {errors.preferred_branch && touched.preferred_branch && (
                    <span className="enq-error-msg" role="alert">{errors.preferred_branch}</span>
                  )}
                </div>

                {/* Reason */}
                <div className="enq-field enq-field-full">
                  <label htmlFor="enq-reason" className="enq-label">
                    Reason for Enquiry <span className="enq-required">*</span>
                  </label>
                  <select
                    id="enq-reason"
                    className={`enq-input enq-select ${errors.reason && touched.reason ? 'enq-input-error' : ''}`}
                    value={form.reason}
                    onChange={(e) => handleChange('reason', e.target.value)}
                    onBlur={() => handleBlur('reason')}
                    disabled={submitting}
                  >
                    <option value="">Select a reason</option>
                    {REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {errors.reason && touched.reason && (
                    <span className="enq-error-msg" role="alert">{errors.reason}</span>
                  )}
                </div>

                {/* Message */}
                <div className="enq-field enq-field-full">
                  <label htmlFor="enq-message" className="enq-label">
                    Message / Goal
                    <span className="enq-char-count">{form.message.length}/500</span>
                  </label>
                  <textarea
                    id="enq-message"
                    className={`enq-input enq-textarea ${errors.message && touched.message ? 'enq-input-error' : ''}`}
                    placeholder="Tell us about your fitness goal, preferred schedule, or any questions..."
                    value={form.message}
                    onChange={(e) => handleChange('message', e.target.value)}
                    onBlur={() => handleBlur('message')}
                    maxLength={500}
                    rows={3}
                    disabled={submitting}
                  />
                  {errors.message && touched.message && (
                    <span className="enq-error-msg" role="alert">{errors.message}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="enq-actions">
                <button
                  type="submit"
                  className="enq-btn-primary"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="enq-spinner-wrap">
                      <span className="enq-spinner" />
                      Submitting...
                    </span>
                  ) : (
                    'Submit Enquiry'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
