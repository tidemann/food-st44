import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../auth';
import { ServerError } from '../pages/server-error';
import { formatShort } from '../recipes/format';
import { Site } from '../site';
import { byTitle, itemsLabel, mealsLabel } from './meal';

/**
 * `/maltider` (ST-1968, ST-1970 pictures 03, 04, 26, 27): every meal, by title, as a register
 * of ruled lines, apart from the recipes. "Nytt måltid" is a button here, not in the menu.
 */
@Component({
  selector: 'app-meal-list',
  imports: [RouterLink, ServerError],
  template: `
    @if (flashMessage(); as message) {
      <div class="wrap">
        <p class="flash" role="status">{{ message }}</p>
      </div>
    }
    @switch (state()) {
      @case ('error') {
        <app-server-error />
      }
      @case ('empty') {
        <div class="wrap">
          <div class="notice">
            <div class="notice-rule"></div>
            <h1>Ingen måltider ennå</h1>
            @if (editor()) {
              <p>
                Legg inn det første, så finner dere det igjen her. Et måltid er en middag uten
                oppskrift — Toro Tandoori chicken, frossenpizza, taco.
              </p>
              <div class="notice-actions">
                <a class="btn btn-primary btn-lg" routerLink="/maltider/ny"
                  >Legg til det første måltidet</a
                >
              </div>
            } @else {
              <p>Når husstanden legger inn måltider, finner du dem her.</p>
            }
          </div>
        </div>
      }
      @case ('ready') {
        <section class="mal-head">
          <div class="wrap">
            <div class="mal-head-rule"></div>
            <div class="mal-head-top">
              <div>
                <h1>Måltider</h1>
                <p class="mal-when">{{ count() }} · middager uten oppskrift</p>
                <p class="mal-lead">
                  Et måltid er en middag uten oppskrift: navnet, og det dere trenger å handle. Ikke
                  noe mer.
                </p>
              </div>
              @if (editor()) {
                <div class="acts">
                  <a class="btn" routerLink="/maltider/ny">Nytt måltid</a>
                </div>
              }
            </div>
          </div>
        </section>

        <section class="mal-body">
          <div class="wrap grid">
            <div class="mal-main">
              <ul class="maltider">
                @for (meal of meals(); track meal.id) {
                  <li>
                    <a [routerLink]="['/maltider', meal.id]">
                      <span class="t">{{ meal.title }}</span>
                      <span class="ldr" aria-hidden="true"></span>
                      <span class="m">{{ meal.items }}</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
            <aside class="mal-side">
              <div class="plan-facts">
                <dl>
                  <div>
                    <dt>Måltider</dt>
                    <dd>{{ meals().length }}</dd>
                  </div>
                  <div>
                    <dt>Oppskrifter</dt>
                    <dd>{{ site.total() }}</dd>
                  </div>
                  @if (latest(); as latest) {
                    <div>
                      <dt>Sist lagt inn</dt>
                      <dd>{{ latest }}</dd>
                    </div>
                  }
                </dl>
                <p class="note">
                  Et måltid kan legges på en dag i ukeplanen, akkurat som en oppskrift.
                </p>
              </div>
            </aside>
          </div>
        </section>
      }
    }
  `,
  // ukeplan.css for the facts column (.plan-facts), as on the week.
  styleUrls: ['../plan/ukeplan.css', './maltid.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealList {
  /** `?flash=deleted` after a meal was deleted. */
  readonly flash = input<string>();

  protected readonly site = inject(Site);
  protected readonly editor = inject(Auth).isEditor;

  protected readonly flashMessage = computed(() =>
    this.flash() === 'deleted' ? 'Måltidet ble slettet.' : undefined,
  );

  protected readonly state = computed(() => {
    const meals = this.site.meals;
    if (meals.error()) return 'error';
    if (!meals.hasValue()) return 'loading';
    return meals.value().length ? 'ready' : 'empty';
  });

  protected readonly meals = computed(() => {
    const meals = this.site.meals.hasValue() ? [...this.site.meals.value()] : [];
    return meals
      .sort(byTitle)
      .map((meal) => ({ id: meal.id, title: meal.title, items: itemsLabel(meal.item_count) }));
  });
  protected readonly count = computed(() => mealsLabel(this.meals().length));
  /** "28. okt": the newest meal's date. */
  protected readonly latest = computed(() => {
    const meals = this.site.meals.hasValue() ? this.site.meals.value() : [];
    const newest = meals
      .map((meal) => meal.created_at)
      .sort()
      .at(-1);
    return newest ? formatShort(newest) : '';
  });

  constructor() {
    inject(Title).setTitle('Måltider — food.st44.no');
  }
}
