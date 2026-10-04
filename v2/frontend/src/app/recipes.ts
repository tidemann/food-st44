import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { Recipe, RecipeInput, ValidationErrors } from './api/types';

/** What a save or a delete came to. Anything but `ok` is shown on the page that asked. */
export type Outcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'invalid'; errors: ValidationErrors['errors'] }
  | { kind: 'not-found' }
  | { kind: 'failed' };

/** Writes to /api/recipes. Reads go through httpResource in the pages. */
@Injectable({ providedIn: 'root' })
export class Recipes {
  private readonly http = inject(HttpClient);

  create(input: RecipeInput): Promise<Outcome<Recipe>> {
    return settle(this.http.post<Recipe>('/api/recipes', input));
  }

  update(id: number, input: RecipeInput): Promise<Outcome<Recipe>> {
    return settle(this.http.put<Recipe>(`/api/recipes/${String(id)}`, input));
  }

  delete(id: number): Promise<Outcome<null>> {
    return settle(this.http.delete<null>(`/api/recipes/${String(id)}`));
  }
}

async function settle<T>(request: Observable<T>): Promise<Outcome<T>> {
  try {
    return { kind: 'ok', value: await firstValueFrom(request) };
  } catch (error) {
    if (!(error instanceof HttpErrorResponse)) throw error;
    if (error.status === 404) return { kind: 'not-found' };
    if (error.status === 422 && isValidationErrors(error.error)) {
      return { kind: 'invalid', errors: error.error.errors };
    }
    return { kind: 'failed' };
  }
}

function isValidationErrors(body: unknown): body is ValidationErrors {
  return typeof body === 'object' && body !== null && 'errors' in body;
}
