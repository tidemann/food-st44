import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../auth';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { dayLong } from '../plan/plan';
import { type Added, type Dish, PlanPick } from '../plan/plan-pick';
import { formatLong } from '../recipes/format';
import { itemsFor, loadMeal } from './meal';

// The `?flash=` keys a meal page answers after a save (the recipe pages have their own).
const FLASH: Partial<Record<string, string>> = {
  created: 'Måltidet ble lagret.',
  updated: 'Endringene ble lagret.',
};

/**
 * `/maltider/:id` (ST-1968, ST-1970 pictures 01, 02, 24, 28): a meal, marked «Måltid» in red,
 * its facts, the things to buy and the note. No photo, no steps, no portions. "Rediger",
 * "Slett" and "Legg til i ukeplan" are for editors.
 */
@Component({
  selector: 'app-meal-detail',
  imports: [RouterLink, NotFound, ServerError, PlanPick],
  templateUrl: './meal-detail.html',
  // The recipe page's head and body (the crumb, the facts, the grid), the week plan's button and
  // panel, and the meal's own sheet.
  styleUrls: ['../recipes/recipe-detail.css', '../plan/ukeplan.css', './maltid.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealDetail {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** `?flash=created|updated` after a save. */
  readonly flash = input<string>();

  protected readonly editor = inject(Auth).isEditor;
  protected readonly flashMessage = computed(() => {
    const key = this.flash();
    return key !== undefined && Object.hasOwn(FLASH, key) ? FLASH[key] : undefined;
  });

  private readonly load = loadMeal(this.id);
  protected readonly state = this.load.state;

  protected readonly view = computed(() => {
    if (!this.load.meal.hasValue()) return undefined;
    const meal = this.load.meal.value();
    return { meal, items: itemsFor(meal.items), added: formatLong(meal.created_at) };
  });

  protected readonly dish = computed<Dish | undefined>(() => {
    const meal = this.view()?.meal;
    return meal && { kind: 'meal', id: meal.id, title: meal.title, servings: null };
  });

  /** "Legg til i ukeplan" is open. */
  protected readonly planOpen = signal(false);
  /** "Lagt til torsdag 29. oktober.", and the week to link to, after a day was set. */
  protected readonly planAdded = signal<{ text: string; week: string } | null>(null);

  protected togglePlan(): void {
    this.planOpen.update((open) => !open);
    this.planAdded.set(null);
  }

  protected planned(added: Added): void {
    this.planOpen.set(false);
    this.planAdded.set({ text: `Lagt til ${dayLong(added.date)}.`, week: added.week });
  }

  constructor() {
    const title = inject(Title);
    effect(() => {
      const view = this.view();
      if (this.state() === 'ready' && view) title.setTitle(`${view.meal.title} — food.st44.no`);
    });
  }
}
