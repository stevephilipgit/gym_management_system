import cors from "cors";
import config from "../config/index.js";

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || config.app.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-CSRF-Token",
    "Accept",
    "Origin",
  ],
  maxAge: 600,
});

export default corsMiddleware;
