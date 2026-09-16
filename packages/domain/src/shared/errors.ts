export class DomainError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = 'DomainError';
  }
}
export const notFound = (what: string) => new DomainError(`${what} not found`, 'not_found', 404);
export const forbidden = (why = 'Not allowed') => new DomainError(why, 'forbidden', 403);
export const conflict = (why: string) => new DomainError(why, 'conflict', 409);
export const invalid = (why: string, details?: unknown) => new DomainError(why, 'invalid', 400, details);
