import { HttpErrorResponse } from '@angular/common/http';
import type { ApiError, ValidationErrors } from '../api/types';

/** Where a recipe comes from on `/recipes/new/link` and `/recipes/new/text` (M5). */
export type ImportSource = 'link' | 'text';

/** POST `{ url }`: the schema.org recipe on the page, as a draft. */
export const LINK_URL = '/api/recipes/import-link';
/** POST `{ text }`: pasted text split into a draft. */
export const TEXT_URL = '/api/recipes/import-text';

/** A failure the API gave no words for (a 403 after the session ran out, a network error). */
export const NOT_IMPORTED = 'Det gikk ikke. Prøv igjen, eller skriv inn oppskriften selv.';

/**
 * What a failed import means for the page: a message under the field (the link or text was
 * refused: 422, or no words from the API), or the site's failure (502, 504), which gets the
 * "could not fetch" screen with its way on.
 */
export function importFailure(
  error: unknown,
  field: 'url' | 'text',
): { field: string } | { site: string } {
  if (!(error instanceof HttpErrorResponse)) return { field: NOT_IMPORTED };
  if (error.status === 422) {
    const body = error.error as Partial<ValidationErrors> | string | null;
    const message = typeof body === 'object' ? body?.errors?.[field] : undefined;
    return { field: message ?? NOT_IMPORTED };
  }
  if (error.status === 502 || error.status === 504) {
    const body = error.error as Partial<ApiError> | string | null;
    const detail = typeof body === 'object' ? body?.detail : undefined;
    if (detail) return { site: detail };
  }
  return { field: NOT_IMPORTED };
}

/** "www.matprat.no" for the link, or the link as typed if it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}
