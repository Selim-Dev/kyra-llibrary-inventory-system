/**
 * Custom error classes for consistent error handling.
 * Each error type maps to a specific HTTP status code.
 */

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request - Invalid input or missing required data
 */
export class BadRequestError extends AppError {
  readonly statusCode = 400;

  constructor(code: string, message: string) {
    super(code, message);
  }
}

/**
 * 404 Not Found - Resource does not exist
 */
export class NotFoundError extends AppError {
  readonly statusCode = 404;

  constructor(code: string, message: string) {
    super(code, message);
  }
}

/**
 * 409 Conflict - Operation cannot be completed due to conflict
 */
export class ConflictError extends AppError {
  readonly statusCode = 409;

  constructor(code: string, message: string) {
    super(code, message);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
export class UnauthorizedError extends AppError {
  readonly statusCode = 401;

  constructor(code: string, message: string) {
    super(code, message);
  }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class ForbiddenError extends AppError {
  readonly statusCode = 403;

  constructor(code: string, message: string) {
    super(code, message);
  }
}
