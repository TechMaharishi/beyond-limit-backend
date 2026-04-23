import winston from "winston";

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  isProduction
    ? winston.format.json()
    : winston.format.colorize({ all: true }),
  isProduction
    ? winston.format.json()
    : winston.format.printf(({ level, message, timestamp, stack }) => {
        return stack
          ? `${timestamp} [${level}]: ${stack}`
          : `${timestamp} [${level}]: ${message}`;
      })
);

const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: "url-shortener" },
  transports: [
    new winston.transports.Console({ format: logFormat }),
  ],
  exitOnError: false,
});

export default logger;
