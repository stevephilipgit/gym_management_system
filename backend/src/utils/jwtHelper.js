import jwt from "jsonwebtoken";
import config from "../config/index.js";

export const issueAccessToken = (payload) =>
  jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires,
    algorithm: "HS256",
  });

export const issueRefreshToken = (payload) =>
  jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpires,
    algorithm: "HS256",
  });

export const verifyAccessToken = (token) => {
  try {
    return { valid: true, payload: jwt.verify(token, config.jwt.accessSecret) };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return { valid: true, payload: jwt.verify(token, config.jwt.refreshSecret) };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};
