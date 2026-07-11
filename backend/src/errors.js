export class AppError extends Error {
  constructor(code, message, statusCode = 400, detail = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export function missingConfigError(system, missing) {
  return new AppError(
    'MISSING_REQUIRED_CONFIG',
    `${system} real mode missing required config: ${missing.join(', ')}`,
    422,
    { system, missing }
  );
}

export function dependencyError(code, message, detail = {}) {
  return new AppError(code, message, 502, detail);
}
