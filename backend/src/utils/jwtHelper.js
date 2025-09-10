import jwt from "jsonwebtoken";
import env from "../config/env.js";

export const issueAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES,
    algorithm: "HS256",
  });

export const issueRefreshToken = (payload) =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES,
    algorithm: "HS256",
  });

export const verifyAccessToken = (token) => {
  try {
    return { valid: true, payload: jwt.verify(token, env.JWT_ACCESS_SECRET) };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return { valid: true, payload: jwt.verify(token, env.JWT_REFRESH_SECRET) };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};
