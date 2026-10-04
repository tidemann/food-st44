import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';

// A missing recipe and a wrong address are the same status but not the same sentence:
// "Fant ikke oppskriften" is a lie on /nonsens/bla (inventory §2.12, §2.13).
const COPY = {
  recipe: {
    heading: 'Fant ikke oppskriften',
    dek: 'Den kan ha blitt slettet, eller lenken er feil.',
  },
  page: {
    heading: 'Siden finnes ikke',
    dek: 'Lenken kan være skrevet feil. Alle oppskriftene ligger samlet på forsiden.',
  },
} as const;

/** S-404R inside the recipe pages, and S-404P as the catch-all route (`data.kind = 'page'`). */
@Component({
  selector: 'app-not-found',
  imports: [Mast, RouterLink],
  template: `
    <app-mast />
    <main id="main" tabindex="-1">
      <div class="wrap">
        <div class="notice">
          <div class="notice-rule"></div>
          <h1>{{ copy().heading }}</h1>
          <p>{{ copy().dek }}</p>
          <div class="notice-actions">
            <a class="btn btn-lg" routerLink="/">Til alle oppskrifter</a>
          </div>
        </div>
      </div>
    </main>
  `,
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {
  readonly kind = input<keyof typeof COPY>('recipe');

  protected readonly copy = computed(() => COPY[this.kind()]);

  constructor() {
    bindTitle(() => `${this.copy().heading} — ${SITE}`);
  }
}
