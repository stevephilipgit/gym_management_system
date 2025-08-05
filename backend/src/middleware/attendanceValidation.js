import mongoose from 'mongoose';
import logger from '../core/logger.js';

const Member = mongoose.model('Member');

/**
 * Attendance validation middleware
 */

/**
 * Detect input type: phone (10 digits) or gymId (4+ digits)
 * Fetches member based on input
 */
export const detectInputTypeAndFetchMember = async (req, res, next) => {
  try {
    let input = req.body.input || req.body.phone || req.body.gymId;

    if (!input) {
      return res.status(400).json({
        success: false,
        message: 'Input required (phone or gym ID)',
      });
    }

    // Normalize: remove all non-digits
    const digitsOnly = String(input).replace(/\D/g, '');

    let member = null;

    // If 10 digits starting with 6-9: treat as phone
    if (/^[6-9]\d{9}$/.test(digitsOnly)) {
      member = await Member.findOne({ phone: digitsOnly }).lean();
      req.inputType = 'phone';
    }
    // If 4+ digits: treat as gymId
    else if (digitsOnly.length >= 4) {
      const gymId = parseInt(digitsOnly);
      member = await Member.findOne({ gymId }).lean();
      req.inputType = 'gymId';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid input format. Use 10-digit phone or gym ID',
      });
    }

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    // Attach to request
    req.body.memberId = member._id;
    req.memberData = member;

    next();
  } catch (error) {
    logger.error('Error detecting input type', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to process input',
    });
  }
};

/**
 * Validate required fields for attendance punch
 */
export const validatePunchInput = (req, res, next) => {
  try {
    const { memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID required',
      });
    }

    next();
  } catch (error) {
    logger.error('Error validating punch input', { error });
    res.status(500).json({
      success: false,
      message: 'Validation failed',
    });
  }
};

/**
 * Validate manual punch input (late punch modal)
 */
export const validateLatePunchInput = (req, res, next) => {
  try {
    const { memberId, action } = req.body;

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID required',
      });
    }

    if (!['mark_entry', 'mark_exit', 'cancel'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action',
      });
    }

    next();
  } catch (error) {
    logger.error('Error validating late punch input', { error });
    res.status(500).json({
      success: false,
      message: 'Validation failed',
    });
  }
};

/**
 * Validate correction input
 */
export const validateCorrectionInput = (req, res, next) => {
  try {
    const { checkInTime, checkOutTime } = req.body;

    if (!checkInTime && !checkOutTime) {
      return res.status(400).json({
        success: false,
        message: 'Check-in time or check-out time required',
      });
    }

    if (checkInTime && isNaN(new Date(checkInTime).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid check-in time format',
      });
    }

    if (checkOutTime && isNaN(new Date(checkOutTime).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid check-out time format',
      });
    }

    next();
  } catch (error) {
    logger.error('Error validating correction input', { error });
    res.status(500).json({
      success: false,
      message: 'Validation failed',
    });
  }
};

/**
 * Validate missing attendance input
 */
export const validateMissingAttendanceInput = (req, res, next) => {
  try {
    const { memberId, date, checkInTime } = req.body;

    if (!memberId || !date || !checkInTime) {
      return res.status(400).json({
        success: false,
        message: 'Member ID, date, and check-in time required',
      });
    }

    if (isNaN(new Date(date).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format',
      });
    }

    if (isNaN(new Date(checkInTime).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid check-in time format',
      });
    }

    next();
  } catch (error) {
    logger.error('Error validating missing attendance input', { error });
    res.status(500).json({
      success: false,
      message: 'Validation failed',
    });
  }
};
