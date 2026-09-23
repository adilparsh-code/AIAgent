/**
 * Auth error types (importable from client bundles without pulling in
 * server-only modules). Route handlers map these to HTTP statuses; login error
 * messages are deliberately vague about *why* credentials failed.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not permitted") {
    super(message);
    this.name = "ForbiddenError";
  }
}
