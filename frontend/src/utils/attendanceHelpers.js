/**
 * Attendance helper utilities for frontend
 */

/**
 * Detect input type: phone or gymId
 * @param {string} input - User input
 * @returns {string | null} - 'phone' or 'gymId' or null if invalid
 */
export function detectInputType(input) {
  if (!input) return null;

  const digitsOnly = String(input).replace(/\D/g, '');

  // 10 digits starting with 6-9: phone
  if (/^[6-9]\d{9}$/.test(digitsOnly)) {
    return 'phone';
  }

  // 4+ digits: gym ID
  if (digitsOnly.length >= 4) {
    return 'gymId';
  }

  return null;
}

/**
 * Validate phone number
 */
export function isValidPhone(phone) {
  const cleaned = String(phone).replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validate gym ID
 */
export function isValidGymId(gymId) {
  const cleaned = String(gymId).replace(/\D/g, '');
  return cleaned.length >= 4;
}

/**
 * Format time HH:MM from Date or string
 */
export function formatTime(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format date DD/MM/YYYY
 */
export function formatDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB');
}

/**
 * Calculate days left from expiry date
 */
export function calculateDaysLeft(expiryDate) {
  if (!expiryDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const diffTime = expiry - today;
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return daysLeft;
}

/**
 * Get status badge class based on days left
 */
export function getStatusClass(daysLeft) {
  if (daysLeft === null) return 'badge-gray';
  if (daysLeft > 7) return 'badge-green';
  if (daysLeft > 0) return 'badge-yellow';
  if (daysLeft === 0) return 'badge-orange';
  return 'badge-red';
}

/**
 * Get status label
 */
export function getStatusLabel(daysLeft) {
  if (daysLeft === null) return 'No Plan';
  if (daysLeft > 0) return `Active (${daysLeft}d)`;
  if (daysLeft === 0) return 'Last Day';
  return 'Expired';
}

/**
 * Format attendance duration
 */
export function formatDuration(minutes) {
  if (!minutes) return '-';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Generate CSV content
 */
export function generateCSV(data, headers) {
  if (!data || data.length === 0) {
    return headers.join(',') + '\n';
  }

  const rows = data.map((row) => {
    return headers.map((header) => {
      const value = row[header] !== undefined ? row[header] : '';
      // Escape quotes and wrap in quotes
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(',');
  });

  return headers.join(',') + '\n' + rows.join('\n');
}

/**
 * Download CSV file
 */
export function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
