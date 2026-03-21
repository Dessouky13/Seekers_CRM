import type { PaginatedResponse } from "../types";

export const DEFAULT_PAGE  = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT     = 200;

/**
 * Parse page + limit from Hono query strings.
 * Returns safe integer values with bounds enforcement.
 */
export function parsePagination(query: Record<string, string | undefined>): {
  page:   number;
  limit:  number;
  offset: number;
} {
  const page  = Math.max(1, parseInt(query.page  ?? "1",  10) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Wrap a data array with pagination metadata.
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return { data, total, page, limit };
}
