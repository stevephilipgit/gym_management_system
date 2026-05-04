/**
 * emailService.js
 * Sends transactional emails using nodemailer.
 * All SMTP credentials come from process.env ONLY.
 * If mail fails, the error is logged but never bubbles to the caller.
 */
import nodemailer from 'nodemailer';
import logger from '../core/logger.js';
import config from '../config/index.js';

/**
 * Build a transporter lazily (only when first needed).
 * Returns null if SMTP is not configured.
 */
function buildTransporter() {
  if (!config.email.enabled) {
    logger.warn('[EmailService] Email service not configured. Email features disabled.');
    return null;
  }

  return {
    transporter: nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
      tls: { rejectUnauthorized: false },
    }),
    from: config.email.from,
  };
}

let _config = null;
function getConfig() {
  if (_config === undefined) return null;
  if (_config) return _config;
  _config = buildTransporter();
  return _config;
}

/**
 * Send an email.
 * @param {object} opts - { to, subject, html, text }
 * @returns {Promise<boolean>} true if sent, false on failure
 */
export async function sendEmail({ to, subject, html, text }) {
  try {
    if (!config.email.enabled) {
      logger.info('[EmailService] Skipping send — email not configured.');
      return false;
    }

    const cfg = getConfig();
    if (!cfg) {
      return false;
    }

    const info = await cfg.transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      html,
      text,
    });

    logger.info('[EmailService] Email sent', {
      to,
      subject,
      messageId: info.messageId,
    });
    return true;
  } catch (err) {
    logger.error('[EmailService] Failed to send email', {
      to,
      subject,
      error: err.message,
    });
    return false;
  }
}

/**
 * Send enquiry notification email to admin.
 * @param {object} enquiry - saved enquiry document
 * @param {string} recipientEmail - configured admin email from settings
 */
export async function sendEnquiryNotification(enquiry, recipientEmail) {
  if (!recipientEmail) {
    logger.warn('[EmailService] No enquiry_notify_email configured — skipping');
    return false;
  }

  const submittedAt = new Date(enquiry.createdAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const subject = `New Enquiry — ${enquiry.reason} | ${enquiry.preferred_branch}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
      <div style="background:#111;padding:20px 24px;">
        <h2 style="color:#ccff00;margin:0;font-size:22px;letter-spacing:1px;">GIRI GYM</h2>
        <p style="color:#aaa;margin:4px 0 0;">New Lead Notification</p>
      </div>
      <div style="padding:24px;background:#fafafa;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:#555;width:140px;"><strong>Name</strong></td><td style="padding:8px 0;color:#111;">${enquiry.name}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Email</strong></td><td style="padding:8px 0;color:#111;">${enquiry.email}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Phone</strong></td><td style="padding:8px 0;color:#111;">${enquiry.phone}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Branch</strong></td><td style="padding:8px 0;color:#111;">${enquiry.preferred_branch}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Reason</strong></td><td style="padding:8px 0;color:#111;">${enquiry.reason}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Message</strong></td><td style="padding:8px 0;color:#111;">${enquiry.message || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#555;"><strong>Submitted</strong></td><td style="padding:8px 0;color:#111;">${submittedAt}</td></tr>
        </table>
      </div>
      <div style="background:#111;padding:12px 24px;text-align:center;">
        <p style="color:#666;font-size:12px;margin:0;">Giri Gym Lead Management System · Auto-generated notification</p>
      </div>
    </div>
  `;

  const text = `New Enquiry from ${enquiry.name}\nPhone: ${enquiry.phone}\nEmail: ${enquiry.email}\nBranch: ${enquiry.preferred_branch}\nReason: ${enquiry.reason}\nMessage: ${enquiry.message || '—'}\nSubmitted: ${submittedAt}`;

  return sendEmail({ to: recipientEmail, subject, html, text });
}
