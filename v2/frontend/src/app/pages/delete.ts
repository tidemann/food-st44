import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';
import { Recipes } from '../recipes';
import { Site } from '../site';
import { ErrorPage } from './error';
import { NotFoundPage } from './not-found';
import { recipeResource, searchParams } from './recipe-resource';

/** S-DELETE, `/recipes/:id/delete` (inventory §2.11). A page of its own, no JS confirm. */
@Component({
  selector: 'app-delete-page',
  imports: [ErrorPage, Mast, NotFoundPage, RouterLink],
  template: `
    @switch (state()) {
      @case ('not-found') {
        <app-not-found />
      }
      @case ('error') {
        <app-error-page />
      }
      @default {
        <app-mast />
        <main id="main" tabindex="-1">
          @if (recipe.value(); as recipe) {
            <div class="wrap">
              <div class="notice">
                <div class="notice-rule"></div>
                <h1>Slett «{{ recipe.title }}»?</h1>
                <p>Oppskriften blir borte for godt. Dette kan ikke angres.</p>
                <form class="notice-actions" (submit)="remove($event, recipe.id)">
                  <a
                    class="btn btn-lg"
                    [routerLink]="['/recipes', recipe.id]"
                    [queryParams]="search()"
                    >Avbryt</a
                  >
                  <button
                    class="btn btn-danger btn-lg"
                    type="submit"
                    [disabled]="deleting()"
                    [attr.aria-busy]="deleting() ? 'true' : null"
                  >
                    Slett oppskriften
                  </button>
                </form>
              </div>
            </div>
          }
        </main>
      }
    }
  `,
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeletePage {
  readonly id = input<string>();
  readonly q = input<string>();

  private readonly recipes = inject(Recipes);
  private readonly site = inject(Site);
  private readonly router = inject(Router);

  protected readonly recipe = recipeResource(this.id);
  protected readonly search = computed(() => searchParams(this.q()));
  protected readonly deleting = signal(false);
  private readonly deleteState = signal<'not-found' | 'error' | null>(null);
  protected readonly state = computed(() => this.deleteState() ?? this.recipe.state());

  constructor() {
    bindTitle(() => {
      const recipe = this.recipe.value();
      return recipe && this.state() === 'ready' ? `Slett «${recipe.title}»? — ${SITE}` : null;
    });
  }

  protected async remove(event: SubmitEvent, id: number): Promise<void> {
    event.preventDefault();
    if (this.deleting()) return;
    this.deleting.set(true);
    const outcome = await this.recipes.delete(id);
    if (outcome.kind === 'ok') {
      this.site.reload();
      // The search is dropped: a deleted recipe has no search to go back to (inventory §3.3).
      await this.router.navigate(['/'], { queryParams: { flash: 'deleted' } });
      return;
    }
    this.deleting.set(false);
    this.deleteState.set(outcome.kind === 'not-found' ? 'not-found' : 'error');
  }
}
