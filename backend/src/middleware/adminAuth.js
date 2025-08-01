import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret_gym_key";

export default function adminAuth(req, res, next) {
  try {
    const token = req.cookies.gym_admin_token;

    if (!token) {
      return res.status(401).json({ message: "Unauthorized. Please login again." });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // { id, username, role }

    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expired. Please login again." });
  }
}
