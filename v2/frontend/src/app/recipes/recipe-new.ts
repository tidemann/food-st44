import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { PhotoReading } from '../api/types';
import { ServerError } from '../pages/server-error';
import { newRecipe } from './new-recipe';
import { READING_URL } from './read-photo';
import { hasErrors, RecipeForm } from './recipe-form';

/**
 * `/recipes/new`: S-NEW and S-NEW-ERR (§2.7, §2.8), with the photo field (M3) and, when reading
 * is on, "Les oppskrift fra bilde" at the top (M4, design row 7).
 */
@Component({
  selector: 'app-recipe-new',
  imports: [RecipeForm, RouterLink, ServerError],
  template: `
    @if (saving.failed()) {
      <app-server-error />
    } @else {
      <div class="wrap">
        <div class="form-head">
          <div class="form-head-rule"></div>
          <h1>Ny oppskrift</h1>
          <p>Tittel og ingredienser må fylles ut. Resten kan du legge til siden.</p>
        </div>
        @if (canRead()) {
          <p class="read-photo">
            <a class="btn" routerLink="/recipes/new/photo">Les oppskrift fra bilde</a>
            <span>Har du oppskriften på papir? Ta et bilde, så fyller vi ut skjemaet.</span>
          </p>
        }
        <app-recipe-form
          submitLabel="Lagre oppskrift"
          [cancelLink]="['/']"
          [errors]="saving.errors()"
          [photoOnly]="saving.created() !== null"
          [busy]="saving.busy()"
          (save)="saving.create($event)"
        />
      </div>
    }
  `,
  styleUrl: './form-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeNew {
  protected readonly saving = newRecipe();

  /** Only editors, and only when a provider is switched on; otherwise the button is not there. */
  private readonly reading = httpResource<PhotoReading>(() => READING_URL);
  protected readonly canRead = computed(
    () => this.reading.hasValue() && this.reading.value().available,
  );

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.saving.failed()) return;
      title.setTitle(
        hasErrors(this.saving.errors()) ? 'Feil — Ny oppskrift' : 'Ny oppskrift — food.st44.no',
      );
    });
  }
}
