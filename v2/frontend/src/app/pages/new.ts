import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { RecipeInput } from '../api/types';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';
import { Recipes } from '../recipes';
import { Site } from '../site';
import { ErrorPage } from './error';
import { type FieldErrors, RecipeForm } from './recipe-form';

/** S-NEW / S-NEW-ERR, `/recipes/new` (inventory §2.7, §2.8). */
@Component({
  selector: 'app-new-page',
  imports: [ErrorPage, Mast, RecipeForm],
  template: `
    @if (failed()) {
      <app-error-page />
    } @else {
      <app-mast nav="new" />
      <main id="main" tabindex="-1">
        <div class="wrap">
          <div class="form-head">
            <div class="rule"></div>
            <h1>Ny oppskrift</h1>
            <p>Tittel og ingredienser må fylles ut. Resten kan du legge til siden.</p>
          </div>
          <app-recipe-form
            mode="new"
            [errors]="errors()"
            [saving]="saving()"
            [cancelLink]="['/']"
            (save)="create($event)"
          />
        </div>
      </main>
    }
  `,
  styleUrl: './form-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewPage {
  private readonly recipes = inject(Recipes);
  private readonly site = inject(Site);
  private readonly router = inject(Router);

  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);
  protected readonly failed = signal(false);
  private readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  constructor() {
    bindTitle(() => (this.hasErrors() ? 'Feil — Ny oppskrift' : `Ny oppskrift — ${SITE}`));
  }

  protected async create(input: RecipeInput): Promise<void> {
    this.saving.set(true);
    const outcome = await this.recipes.create(input);
    if (outcome.kind === 'ok') {
      this.site.reload();
      await this.router.navigate(['/recipes', outcome.value.id], {
        queryParams: { flash: 'created' },
      });
      return;
    }
    this.saving.set(false);
    if (outcome.kind === 'invalid') this.errors.set(outcome.errors);
    else this.failed.set(true);
  }
}
