import { Response } from "express";

// Small, dependency-free error helpers shared by every controller. The real
// innocrm-staging codebase already has an equivalent module at this path —
// this reproduces the signature every controller in this bundle expects.

export function handleError(error: unknown, res: Response, context: string) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(`[${context}]`, error);
  res.status(500).json({ success: false, message: `${context} failed: ${message}` });
}

export function handleValidationError(res: Response, message: string, field: string, context: string) {
  res.status(400).json({ success: false, message, field, context });
}

export function handleNotFoundError(res: Response, entity: string, context: string) {
  res.status(404).json({ success: false, message: `${entity} not found`, context });
}
