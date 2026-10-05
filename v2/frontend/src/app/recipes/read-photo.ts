import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import type { CanMatchFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiError, PhotoReading, ValidationErrors } from '../api/types';
import { NOT_AN_IMAGE, TOO_LARGE } from './photo';

/** GET: whether reading is offered to this visitor. POST: read the photo in `photo`. */
export const READING_URL = '/api/recipes/read-photo';

/** A failure the API gave no words for (a 403 after the session ran out, a network error). */
export const NOT_READ = 'Bildet ble ikke lest. Prøv igjen, eller skriv inn oppskriften selv.';

/**
 * `/recipes/new/photo` only matches when reading is on for this visitor. Anyone else lands on
 * `/recipes/new`: the form for an editor, "Ingen tilgang" for the rest.
 */
export const readingAvailable: CanMatchFn = async () => {
  try {
    const reading = await firstValueFrom(inject(HttpClient).get<PhotoReading>(READING_URL));
    return reading.available;
  } catch {
    return false;
  }
};

/**
 * What a failed read says under the photo field. The API words the file's problems (413, 422)
 * and the provider's (502 failed, 503 switched off, 504 too slow); anything else gets NOT_READ.
 */
export function readFailure(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return NOT_READ;
  if (error.status === 413 || error.status === 422) {
    // A 413 from nginx, before Django, is its own HTML page.
    const body = error.error as Partial<ValidationErrors> | string | null;
    const message = typeof body === 'object' ? body?.errors?.['photo'] : undefined;
    return message ?? (error.status === 413 ? TOO_LARGE : NOT_AN_IMAGE);
  }
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    const body = error.error as Partial<ApiError> | string | null;
    const detail = typeof body === 'object' ? body?.detail : undefined;
    if (detail) return detail;
  }
  return NOT_READ;
}
