import { HttpClient } from '@angular/common/http';
import { inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Recipe } from '../api/types';
import { Site } from '../site';
import { PhotoStepError, saveWithPhoto } from './photo';
import { type FieldErrors, type RecipeSave, saveFailure } from './recipe-form';

/**
 * Saving a new recipe: S-NEW, and the form filled in from a photo (M4), which saves the same way.
 * Call it from a field initialiser (it injects).
 */
export function newRecipe() {
  const http = inject(HttpClient);
  const router = inject(Router);
  const site = inject(Site);

  const errors = signal<FieldErrors>({});
  const busy = signal(false);
  const failed = signal(false);
  /**
   * The recipe, once its text is saved but its photo was refused. The next "Lagre" then updates
   * it and sends the photo again, instead of adding the recipe twice.
   */
  const created = signal<number | null>(null);

  function create({ recipe: input, photo }: RecipeSave): void {
    busy.set(true);
    const id = created();
    const text =
      id === null
        ? http.post<Recipe>('/api/recipes', input)
        : http.put<Recipe>(`/api/recipes/${String(id)}`, input);
    saveWithPhoto(http, text, photo, (saved) => {
      created.set(saved.id);
    }).subscribe({
      next: (recipe) => {
        // The count, the front page and "Sist oppdatert" all come from the collection.
        site.recipes.reload();
        void router.navigate(['/recipes', recipe.id], { queryParams: { flash: 'created' } });
      },
      error: (error: unknown) => {
        busy.set(false);
        // The recipe is in the collection now, if without its photo.
        if (error instanceof PhotoStepError) site.recipes.reload();
        const failure = saveFailure(error);
        if (typeof failure === 'string') failed.set(true);
        else errors.set(failure);
      },
    });
  }

  return {
    errors: errors.asReadonly(),
    busy: busy.asReadonly(),
    failed: failed.asReadonly(),
    created: created.asReadonly(),
    create,
  };
}
