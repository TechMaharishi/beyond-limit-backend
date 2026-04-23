import { Response } from "express";

type Meta = Record<string, unknown> | undefined;
type Data = unknown;
type Errors = unknown;

export const sendSuccess = (
  res: Response,
  statusCode: number,
  message: string,
  data?: Data,
  meta?: Meta
) => {
  const payload: Record<string, unknown> = {
    success: true,
    message,
  };
  if (data !== undefined) payload.data = data;
  if (meta !== undefined) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  errors?: Errors
) => {
  const payload: Record<string, unknown> = {
    success: false,
    message,
  };
  if (errors !== undefined) payload.errors = errors;
  return res.status(statusCode).json(payload);
};