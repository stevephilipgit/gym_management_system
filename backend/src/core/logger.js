// core/logger.js - Winston logging setup
import winston from "winston";
import env from "./config.js";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const customFormat = printf(({ level, message, timestamp, ...meta }) => {
  let metaStr = "";
  if (Object.keys(meta).length > 0 && meta.stack === undefined) {
    metaStr = JSON.stringify(meta);
  }
  return `[${timestamp}] [${level}] ${message}${metaStr ? " " + metaStr : ""}${
    meta.stack ? "\n" + meta.stack : ""
  }`;
});

// Create logger instance
const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    customFormat
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(colorize(), customFormat),
    }),

    // File transports
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: "logs/exceptions.log" }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: "logs/rejections.log" }),
  ],
});

export default logger;
