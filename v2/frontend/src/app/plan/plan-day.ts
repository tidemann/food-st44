import { HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { PlanDay as Day, PlanWeek, Recipe, ValidationErrors } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { ingredientLines, pluralise } from '../recipes/format';
import { Site } from '../site';
import {
  capitalise,
  dayLong,
  dayShort,
  dinnerOf,
  isDate,
  isEmpty,
  Plan,
  PlanNotice,
  portionsLabel,
  weekday,
  weekUrl,
  whenSet,
} from './plan';

/** What the day page shows: the dinner on it, the search for a new one, or the one picked. */
type Mode = 'current' | 'pick' | 'chosen';

/** The API's messages for the fields on this page; `form` is anything else that went wrong. */
interface Errors {
  text?: string;
  portions?: string;
  form?: string;
}

const NOT_SAVED = 'Endringen ble ikke lagret. Prøv igjen.';

/** "Kjøttkaker", "kjøtt": the front page's rule (food.services.search_recipes), title only. */
function matches(recipe: Recipe, needle: string): boolean {
  return recipe.title.toLowerCase().includes(needle);
}

const byTitle = (a: Recipe, b: Recipe): number => a.title.localeCompare(b.title, 'nb');

/**
 * `/ukeplan/2026-10-23` (ST-1231, ST-1213 pictures 03a–03c, 04a): one day of the week plan.
 * An empty day opens on the search; a planned one shows its dinner, with portions to change,
 * another dinner to pick, the other days to move it to (a taken day swaps), and "Fjern".
 * Every change goes back to the week with a line saying what happened.
 */
@Component({
  selector: 'app-plan-day',
  imports: [NgTemplateOutlet, RouterLink, NotFound, ServerError],
  templateUrl: './plan-day.html',
  styleUrls: ['./ukeplan.css', './plan-day.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanDay {
  /** The `:date` route parameter. */
  readonly date = input.required<string>();

  private readonly plan = inject(Plan);
  private readonly notice = inject(PlanNotice);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  private readonly valid = computed(() => isDate(this.date()));
  private readonly week = httpResource<PlanWeek>(() =>
    this.valid() ? weekUrl(this.date()) : undefined,
  );
  protected readonly state = computed(() => {
    if (!this.valid()) return 'not-found';
    const error = this.week.error();
    if (error) {
      return error instanceof HttpErrorResponse && error.status === 422 ? 'not-found' : 'error';
    }
    return this.week.hasValue() ? 'ready' : 'loading';
  });

  protected readonly view = computed(() => {
    if (!this.week.hasValue()) return undefined;
    const week = this.week.value();
    const day = week.days.find((d) => d.date === this.date());
    if (!day) return undefined;
    const isToday = day.date === week.today;
    return {
      week,
      day,
      empty: isEmpty(day),
      today: isToday,
      heading: capitalise(dayLong(day.date)),
      short: dayShort(day.date),
      setBy: day.set_by && day.set_at ? `${day.set_by}, ${whenSet(day.set_at, week.today)}` : '',
      /** "ingen middag ennå", "satt av Maria i går" */
      state: isEmpty(day)
        ? 'ingen middag ennå'
        : day.set_by && day.set_at
          ? `satt av ${day.set_by} ${whenSet(day.set_at, week.today)}`
          : '',
      others: week.days
        .filter((d) => d.date !== day.date)
        .map((d) => ({
          ...d,
          label: dayShort(d.date),
          today: d.date === week.today,
          dinner: dinnerOf(d),
        })),
    };
  });

  /** The page opens on the dinner, or on the search for an empty day. */
  protected readonly mode = linkedSignal<Mode>(() => {
    const view = this.view();
    return view && !view.empty ? 'current' : 'pick';
  });

  // --- the search: the whole collection, in alphabetical order, filtered as on the front page
  protected readonly q = signal('');
  protected readonly collectionSize = computed(() =>
    pluralise(this.site.total(), 'oppskrift', 'oppskrifter'),
  );
  protected readonly hits = computed(() => {
    if (!this.site.recipes.hasValue()) return [];
    const needle = this.q().trim().toLowerCase();
    return this.site.recipes
      .value()
      .filter((recipe) => !needle || matches(recipe, needle))
      .sort(byTitle);
  });

  /** The recipe picked from the search, before it is saved. */
  protected readonly chosen = signal<Recipe | undefined>(undefined);
  /** The day's recipe as the collection has it, for its ingredient count. */
  protected readonly current = computed(() => {
    const id = this.view()?.day.recipe_id;
    return id == null ? undefined : this.recipeById(id);
  });
  /** The portions field: the day's own, or the picked recipe's servings. */
  protected readonly portions = linkedSignal(() => {
    if (this.mode() === 'chosen') return this.chosen()?.servings ?? null;
    return this.view()?.day.portions ?? null;
  });
  protected readonly portionsHint = computed(() => {
    const servings = this.mode() === 'chosen' ? this.chosen()?.servings : this.view()?.day.servings;
    if (!servings) {
      return 'Oppskriften har ingen porsjoner. Settes den ikke, brukes oppskriften som den er skrevet.';
    }
    const change = this.mode() === 'chosen' ? ' Endre hvis dere er flere eller færre.' : '';
    return `Står til ${String(servings)}, fra oppskriften.${change}`;
  });
  protected readonly text = linkedSignal(() => this.view()?.day.text ?? '');

  protected readonly busy = signal(false);
  protected readonly errors = signal<Errors>({});

  private readonly textField = viewChild<ElementRef<HTMLInputElement>>('textField');
  private readonly focusText = signal(false);

  constructor() {
    const title = inject(Title);
    effect(() => {
      const view = this.view();
      title.setTitle(view ? `Ukeplan: ${view.heading} — food.st44.no` : 'Ukeplan — food.st44.no');
    });
    // "Skriv en kort tekst i stedet" lands in the text field.
    effect(() => {
      const field = this.textField();
      if (field && this.focusText()) {
        field.nativeElement.focus();
        this.focusText.set(false);
      }
    });
  }

  protected countOf(recipe: Recipe): string {
    return pluralise(ingredientCount(recipe), 'ingrediens', 'ingredienser');
  }

  protected servingsOf(servings: number | null): string {
    return servings ? `${portionsLabel(servings)} i oppskriften` : 'ingen porsjoner i oppskriften';
  }

  protected search(value: string): void {
    this.q.set(value);
  }

  protected choose(recipe: Recipe): void {
    this.chosen.set(recipe);
    this.errors.set({});
    this.mode.set('chosen');
  }

  protected pick(focusText = false): void {
    this.errors.set({});
    this.mode.set('pick');
    this.focusText.set(focusText);
  }

  protected setPortions(value: string): void {
    const portions = Number.parseInt(value, 10);
    this.portions.set(Number.isNaN(portions) ? null : portions);
  }

  /** "Legg til middag" / "Lagre endringer": the picked recipe, or the day's own with new portions. */
  protected async saveRecipe(event: Event): Promise<void> {
    event.preventDefault();
    const view = this.view();
    const recipeId = this.mode() === 'chosen' ? this.chosen()?.id : view?.day.recipe_id;
    if (!view || recipeId == null) return;
    const title = this.mode() === 'chosen' ? (this.chosen()?.title ?? '') : view.day.title;
    const message = view.empty
      ? `${title} er lagt til ${dayLong(view.day.date)}.`
      : `${capitalise(dayLong(view.day.date))} er endret: ${title}.`;
    await this.run(
      () => this.plan.set(view.day.date, { recipe_id: recipeId, portions: this.portions() }),
      message,
    );
  }

  protected async saveText(event: Event): Promise<void> {
    event.preventDefault();
    const view = this.view();
    if (!view) return;
    const text = this.text().trim();
    const message = `«${text}» er satt på ${dayLong(view.day.date)}.`;
    await this.run(() => this.plan.set(view.day.date, { text }), message);
  }

  protected async move(to: Day): Promise<void> {
    const view = this.view();
    if (!view) return;
    const what = dinnerOf(view.day);
    const target = dayLong(to.date);
    const message = isEmpty(to)
      ? `${what} ble flyttet til ${target}. ${capitalise(weekday(view.day.date))} er nå tom.`
      : `${what} og ${dinnerOf(to)} byttet plass: ${what} står nå ${target}, ` +
        `${dinnerOf(to)} ${dayLong(view.day.date)}.`;
    await this.run(() => this.plan.move(view.day.date, to.date), message);
  }

  protected async remove(): Promise<void> {
    const view = this.view();
    if (!view) return;
    const message = `${dinnerOf(view.day)} er fjernet fra ${dayLong(view.day.date)}.`;
    await this.run(() => this.plan.clear(view.day.date), message);
  }

  /** Sends one change; on success, back to the week with `message`. */
  private async run(change: () => Promise<unknown>, message: string): Promise<void> {
    const week = this.view()?.week.week;
    if (this.busy() || !week) return;
    this.busy.set(true);
    this.errors.set({});
    try {
      await change();
    } catch (error) {
      this.errors.set(errorsOf(error));
      this.busy.set(false);
      return;
    }
    this.notice.set(message);
    await this.router.navigate(['/ukeplan'], { queryParams: { uke: week } });
  }

  private recipeById(id: number): Recipe | undefined {
    return this.site.recipes.hasValue()
      ? this.site.recipes.value().find((recipe) => recipe.id === id)
      : undefined;
  }
}

function ingredientCount(recipe: Recipe): number {
  return ingredientLines(recipe.ingredients).length;
}

/** A 422 names the field; anything else is "not saved". */
function errorsOf(error: unknown): Errors {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const body = error.error as Partial<ValidationErrors> | null;
    const errors = body?.errors ?? {};
    if (errors['portions']) return { portions: errors['portions'] };
    if (errors['text']) return { text: errors['text'] };
  }
  return { form: NOT_SAVED };
}
