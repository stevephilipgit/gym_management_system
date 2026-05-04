// controllers/healthController.js - System health check
import mongoose from "mongoose";
import redisClient from "../config/redis.js";
import { asyncHandler } from "../core/errorHandler.js";
import config from "../config/index.js";

export const healthController = {
  // Health check endpoint
  healthCheck: asyncHandler(async (req, res) => {
    const healthStatus = {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        database: "checking",
        redis: "checking",
        api: "ok",
      },
    };

    // Check MongoDB
    try {
      if (mongoose.connection.readyState === 1) {
        healthStatus.services.database = "ok";
      } else {
        healthStatus.services.database = "disconnected";
        healthStatus.status = "degraded";
      }
    } catch (err) {
      healthStatus.services.database = "error";
      healthStatus.status = "error";
    }

    // Check Redis
    try {
      const pong = await redisClient.ping();
      if (pong === "PONG") {
        healthStatus.services.redis = "ok";
      } else {
        healthStatus.services.redis = "error";
        healthStatus.status = "degraded";
      }
    } catch (err) {
      healthStatus.services.redis = "error";
      healthStatus.status = "degraded";
    }

    const statusCode = healthStatus.status === "ok" ? 200 : healthStatus.status === "degraded" ? 503 : 500;

    return res.status(statusCode).json(healthStatus);
  }),

  // Extended health info
  healthInfo: asyncHandler(async (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const mongoStatus = mongoose.connection.readyState; // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting

    const info = {
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        hours: Math.floor(uptime / 3600),
      },
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + " MB",
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + " MB",
        external: Math.round(memoryUsage.external / 1024 / 1024) + " MB",
      },
      database: {
        state: ["disconnected", "connected", "connecting", "disconnecting"][mongoStatus],
        stateCode: mongoStatus,
      },
      nodeVersion: process.version,
      environment: config.env,
    };

    return res.json({
      success: true,
      data: info,
    });
  }),
};

export default healthController;
