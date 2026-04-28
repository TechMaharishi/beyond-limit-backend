import rateLimit from "express-rate-limit";

/**
 * Standard rate limiter for mutation endpoints (POST, PUT, PATCH, DELETE).
 * 30 requests per IP per 15 minutes.
 */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

/**
 * Stricter limiter for sensitive endpoints (auth, OTP, password reset).
 * 10 requests per IP per 15 minutes.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});
