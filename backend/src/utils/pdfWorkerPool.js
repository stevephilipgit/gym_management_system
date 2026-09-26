// utils/pdfWorkerPool.js - Dispatches PDF generation to a worker thread.
//
// Keeps the main event loop free while pdfkit performs layout calculation and
// font subsetting. One short-lived Worker per request (spawn + terminate);
// no external queue dependencies.

import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Offloads PDF generation to a worker thread to keep the main event loop non-blocking.
 * @param {Object} metrics - Aggregated analytics metrics from analyticsService.
 * @param {Object} dateRange - { startDate, endDate } strings rendered into the PDF header.
 * @returns {Promise<Buffer>} Resolves with the generated PDF buffer.
 */
export function generatePDFInWorker(metrics, dateRange) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "../workers/pdfWorker.js");

    const worker = new Worker(workerPath, {
      workerData: { metrics, dateRange },
    });

    worker.on("message", (message) => {
      if (message.success) {
        resolve(Buffer.from(message.pdfBuffer));
      } else {
        reject(new Error(message.error || "Failed to generate PDF in worker."));
      }
      worker.terminate();
    });

    worker.on("error", (err) => {
      worker.terminate();
      reject(err);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`PDF Worker thread stopped with exit code ${code}`));
      }
    });
  });
}
