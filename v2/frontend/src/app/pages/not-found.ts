import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

// A missing recipe and a wrong address are the same status but not the same sentence:
// "Fant ikke oppskriften" is a lie on /nonsens/bla.
const TEXT = {
  recipe: {
    heading: 'Fant ikke oppskriften',
    dek: 'Den kan ha blitt slettet, eller lenken er feil.',
  },
  page: {
    heading: 'Siden finnes ikke',
    dek: 'Lenken kan være skrevet feil. Alle oppskriftene ligger samlet på forsiden.',
  },
} as const;

/** S-404R (§2.12) and S-404P (§2.13). */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="notice">
        <div class="notice-rule"></div>
        <h1>{{ text().heading }}</h1>
        <p>{{ text().dek }}</p>
        <div class="notice-actions">
          <a class="btn btn-lg" routerLink="/">Til alle oppskrifter</a>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {
  /**
   * "recipe" from the recipe page. As a route component it is a page 404; the router's input
   * binding then sets this to undefined, not to the default, hence the `??`.
   */
  readonly kind = input<keyof typeof TEXT>();
  protected readonly text = computed(() => TEXT[this.kind() ?? 'page']);

  constructor() {
    const title = inject(Title);
    effect(() => {
      title.setTitle(`${this.text().heading} — food.st44.no`);
    });
  }
}
