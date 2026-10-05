import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import type { Recipe } from '../api/types';
import { ServerError } from '../pages/server-error';
import { Site } from '../site';
import { PhotoStepError, saveWithPhoto } from './photo';
import {
  type FieldErrors,
  hasErrors,
  RecipeForm,
  type RecipeSave,
  saveFailure,
} from './recipe-form';

/** `/recipes/new`: S-NEW and S-NEW-ERR (§2.7, §2.8), with the photo field (M3). */
@Component({
  selector: 'app-recipe-new',
  imports: [RecipeForm, ServerError],
  template: `
    @if (failed()) {
      <app-server-error />
    } @else {
      <div class="wrap">
        <div class="form-head">
          <div class="form-head-rule"></div>
          <h1>Ny oppskrift</h1>
          <p>Tittel og ingredienser må fylles ut. Resten kan du legge til siden.</p>
        </div>
        <app-recipe-form
          submitLabel="Lagre oppskrift"
          [cancelLink]="['/']"
          [errors]="errors()"
          [photoOnly]="created() !== null"
          [busy]="busy()"
          (save)="create($event)"
        />
      </div>
    }
  `,
  styleUrl: './form-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeNew {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  protected readonly errors = signal<FieldErrors>({});
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  /**
   * The recipe, once its text is saved but its photo was refused. The next "Lagre" then updates
   * it and sends the photo again, instead of adding the recipe twice.
   */
  protected readonly created = signal<number | null>(null);

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.failed()) return;
      title.setTitle(
        hasErrors(this.errors()) ? 'Feil — Ny oppskrift' : 'Ny oppskrift — food.st44.no',
      );
    });
  }

  protected create({ recipe: input, photo }: RecipeSave): void {
    this.busy.set(true);
    const id = this.created();
    const text =
      id === null
        ? this.http.post<Recipe>('/api/recipes', input)
        : this.http.put<Recipe>(`/api/recipes/${String(id)}`, input);
    saveWithPhoto(this.http, text, photo, (saved) => {
      this.created.set(saved.id);
    }).subscribe({
      next: (recipe) => {
        // The count, the front page and "Sist oppdatert" all come from the collection.
        this.site.recipes.reload();
        void this.router.navigate(['/recipes', recipe.id], { queryParams: { flash: 'created' } });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        // The recipe is in the collection now, if without its photo.
        if (error instanceof PhotoStepError) this.site.recipes.reload();
        const failure = saveFailure(error);
        if (typeof failure === 'string') this.failed.set(true);
        else this.errors.set(failure);
      },
    });
  }
}
