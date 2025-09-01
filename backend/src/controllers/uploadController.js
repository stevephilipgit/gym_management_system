// controllers/uploadController.js - File upload handling
import { asyncHandler, ValidationError } from "../core/errorHandler.js";

export const uploadController = {
  // Upload member photo
  uploadPhoto: asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("No file provided");
    }

    const photoUrl = `/uploads/${req.file.filename}`;

    return res.status(201).json({
      success: true,
      message: "Photo uploaded successfully",
      data: {
        photoUrl,
        fileName: req.file.filename,
        size: req.file.size,
      },
    });
  }),

  // Upload bulk data (CSV, Excel, etc.)
  uploadBulkData: asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("No file provided");
    }

    // File validation
    const allowedMimes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (!allowedMimes.includes(req.file.mimetype)) {
      throw new ValidationError("Invalid file type. Only CSV and Excel files are allowed");
    }

    return res.status(201).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  }),

  // Get file info
  getFileInfo: asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("No file information available");
    }

    return res.json({
      success: true,
      data: {
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        uploadedAt: new Date(),
      },
    });
  }),
};

export default uploadController;
