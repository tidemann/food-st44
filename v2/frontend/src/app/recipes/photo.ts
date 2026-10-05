import type { HttpClient } from '@angular/common/http';
import { catchError, map, type Observable, of, switchMap, tap, throwError } from 'rxjs';
import type { Recipe } from '../api/types';

/**
 * What "Lagre" does with the recipe's photo: leave it, take it away, or send this file. Nothing
 * reaches the API before the save (design row 5).
 */
export type PhotoChange = 'keep' | 'remove' | File;

/** The types the API takes. It checks the content; this only stops the obvious ones early. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** The API's limit (settings.PHOTO_MAX_UPLOAD_BYTES). A phone photo of 10 MB+ must get through. */
export const PHOTO_MAX_MB = 25;
const PHOTO_MAX_BYTES = PHOTO_MAX_MB * 2 ** 20;

export const TOO_LARGE = `Bildet er for stort. Velg et bilde under ${String(PHOTO_MAX_MB)} MB.`;
export const NOT_AN_IMAGE = 'Denne filen er ikke et bilde. Velg en JPEG, PNG eller WEBP.';
/** The photo request failed for a reason the user cannot fix in the field (403, 5xx). */
export const PHOTO_NOT_SAVED = 'Bildet ble ikke lagret. Prøv å lagre igjen.';

/** Why the file cannot be the recipe's photo, or null if it may be sent. */
export function photoProblem(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return NOT_AN_IMAGE;
  if (file.size > PHOTO_MAX_BYTES) return TOO_LARGE;
  return null;
}

const decimal = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });

/** "2,4 MB", "310 kB". */
export function formatSize(bytes: number): string {
  return bytes < 2 ** 20
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} kB`
    : `${decimal.format(bytes / 2 ** 20)} MB`;
}

/** The recipe was saved, but its photo was not: the error is in `cause`. */
export class PhotoStepError extends Error {
  constructor(override readonly cause: unknown) {
    super('photo not saved');
  }
}

/**
 * Saves the recipe text, then the photo change. `saved` sees the recipe as soon as the text is in,
 * so a page can remember a new recipe's id when the photo then fails.
 */
export function saveWithPhoto(
  http: HttpClient,
  text: Observable<Recipe>,
  photo: PhotoChange,
  saved: (recipe: Recipe) => void = () => undefined,
): Observable<Recipe> {
  return text.pipe(
    tap(saved),
    switchMap((recipe) =>
      sendPhoto(http, recipe.id, photo).pipe(
        map((updated) => updated ?? recipe),
        catchError((error: unknown) => throwError(() => new PhotoStepError(error))),
      ),
    ),
  );
}

function sendPhoto(http: HttpClient, id: number, photo: PhotoChange): Observable<Recipe | null> {
  const url = `/api/recipes/${String(id)}/photo`;
  if (photo === 'keep') return of(null);
  if (photo === 'remove') return http.delete<Recipe>(url);
  const body = new FormData();
  body.append('photo', photo);
  return http.post<Recipe>(url, body);
}
