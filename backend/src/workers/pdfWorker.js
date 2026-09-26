// workers/pdfWorker.js - Worker thread entry point for CPU-bound PDF rendering.
//
// Runs OFF the main event loop: receives { metrics, dateRange } via workerData,
// invokes pdfkit through PDFGenerator.generateAnalyticsPDF, and posts the
// resulting Buffer back to the parent thread. No DB access happens here.

import { parentPort, workerData } from "worker_threads";
import PDFGenerator from "../utils/pdfGenerator.js";

async function run() {
  try {
    const { metrics, dateRange } = workerData;
    if (!metrics || !dateRange) {
      throw new Error("Missing metrics or dateRange payload in workerData.");
    }

    const pdfBuffer = await PDFGenerator.generateAnalyticsPDF(metrics, dateRange);
    parentPort.postMessage({ success: true, pdfBuffer });
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

run();
