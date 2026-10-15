import { HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import type { PlanDay, PlanWeek, Recipe, ValidationErrors } from '../api/types';
import { capitalise, dayShort, dinnerOf, Plan, weekday, weekUrl } from './plan';

/** What the recipe page is told after a save: the day, and the week to link to. */
export interface Added {
  date: string;
  week: string;
}

interface Column {
  heading: string;
  week: string;
  days: (PlanDay & { label: string; today: boolean; dinner: string })[];
}

/**
 * "Legg til i ukeplan" on the recipe page (ST-1231, ST-1213 pictures 05a–05d): the days of this
 * week and the next, what each already has, and the portions. An empty day is set at once; a
 * taken one asks first. The recipe page owns the button and the "Lagt til" line.
 */
@Component({
  selector: 'app-plan-pick',
  templateUrl: './plan-pick.html',
  styleUrl: './ukeplan.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanPick {
  readonly recipe = input.required<Recipe>();
  readonly added = output<Added>();

  private readonly plan = inject(Plan);

  private readonly thisWeek = httpResource<PlanWeek>(() => weekUrl(''));
  private readonly nextWeek = httpResource<PlanWeek>(() =>
    this.thisWeek.hasValue() ? weekUrl(this.thisWeek.value().next) : undefined,
  );
  protected readonly failed = computed(
    () => this.thisWeek.error() !== undefined || this.nextWeek.error() !== undefined,
  );

  protected readonly columns = computed<Column[] | undefined>(() => {
    if (!this.thisWeek.hasValue() || !this.nextWeek.hasValue()) return undefined;
    const today = this.thisWeek.value().today;
    const column = (heading: string, week: PlanWeek): Column => ({
      heading: `${heading} · uke ${String(week.number)}`,
      week: week.week,
      days: week.days.map((day) => ({
        ...day,
        label: dayShort(day.date),
        today: day.date === today,
        dinner: dinnerOf(day),
      })),
    });
    return [
      column('Denne uken', this.thisWeek.value()),
      column('Neste uke', this.nextWeek.value()),
    ];
  });

  /** The taken day waiting for "Bytt til …", and its week. */
  protected readonly confirming = signal<{ day: Column['days'][number]; column: Column } | null>(
    null,
  );
  /** The confirm step shows the chosen day's week up to that day, then the question. */
  protected readonly confirmDays = computed(() => {
    const confirming = this.confirming();
    if (!confirming) return [];
    const { day, column } = confirming;
    return column.days.slice(0, column.days.indexOf(day) + 1);
  });

  protected readonly portions = linkedSignal<number | null>(() => this.recipe().servings);
  protected readonly portionsHint = computed(() => {
    const servings = this.recipe().servings;
    return servings
      ? `Står til ${String(servings)}, fra oppskriften.`
      : 'Oppskriften har ingen porsjoner. Settes den ikke, brukes oppskriften som den er skrevet.';
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected setPortions(value: string): void {
    const portions = Number.parseInt(value, 10);
    this.portions.set(Number.isNaN(portions) ? null : portions);
  }

  protected choose(day: Column['days'][number], column: Column): void {
    if (day.dinner) {
      this.confirming.set({ day, column });
      return;
    }
    void this.save(day.date, column.week);
  }

  /** "Torsdag har Kjøttkaker i brun saus" */
  protected question(day: PlanDay): string {
    return `${capitalise(weekday(day.date))} har ${dinnerOf(day)}`;
  }

  protected replaces(day: PlanDay): string {
    const old = dinnerOf(day);
    const kept = day.recipe_id !== null ? ` ${old} blir liggende i samlingen.` : '';
    return `Legger dere til ${this.recipe().title}, erstatter den ${old}.${kept}`;
  }

  protected async save(date: string, week: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.plan.set(date, { recipe_id: this.recipe().id, portions: this.portions() });
    } catch (error) {
      this.error.set(messageOf(error));
      this.busy.set(false);
      return;
    }
    this.busy.set(false);
    this.confirming.set(null);
    this.added.emit({ date, week });
  }
}

function messageOf(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const body = error.error as Partial<ValidationErrors> | null;
    const portions = body?.errors?.['portions'];
    if (portions) return portions;
  }
  return 'Middagen ble ikke lagt til. Prøv igjen.';
}
