import jwt from "jsonwebtoken";
import config from "../config/index.js";

export default function adminAuth(req, res, next) {
  try {
    const token = req.cookies.gym_admin_token;

    if (!token) {
      return res.status(401).json({ message: "Unauthorized. Please login again." });
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret);
    req.admin = decoded; // { id, username, role }

    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expired. Please login again." });
  }
}
