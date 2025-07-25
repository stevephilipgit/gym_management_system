// core/attendanceLogger.js - Dedicated attendance audit logger
import winston from 'winston';

const { combine, timestamp, printf } = winston.format;

// Plain-text format matching the spec
const attendanceFormat = printf(({ level, message, timestamp }) => {
  const tag = level === 'warn' ? 'WARN' : 'INFO';
  return `[${timestamp}] [${tag}] ${message}`;
});

const attendanceLogger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    attendanceFormat
  ),
  transports: [
    // Console (for dev visibility)
    new winston.transports.Console(),
    // Dedicated attendance log file
    new winston.transports.File({
      filename: 'logs/attendance.log',
      maxsize: 5242880, // 5 MB
      maxFiles: 5,
    }),
  ],
});

export default attendanceLogger;
