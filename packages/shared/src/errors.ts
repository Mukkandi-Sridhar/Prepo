export type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid_input"
  | "repo_too_large"
  | "clone_failed"
  | "no_api_key"
  | "provider_error"
  | "budget_exceeded"
  | "rate_limited"
  | "unsafe_archive"
  | "internal";

/** Errors that are safe to show a user verbatim. Everything else becomes "internal". */
export class PrepoError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PrepoError";
  }

  get status(): number {
    switch (this.code) {
      case "unauthorized":
        return 401;
      case "not_found":
        return 404;
      case "invalid_input":
      case "repo_too_large":
      case "unsafe_archive":
        return 400;
      case "no_api_key":
      case "budget_exceeded":
        return 402;
      case "rate_limited":
        return 429;
      default:
        return 500;
    }
  }
}

export function toPublicError(err: unknown): { code: ErrorCode; message: string; status: number } {
  if (err instanceof PrepoError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  return { code: "internal", message: "Something went wrong on the server.", status: 500 };
}
