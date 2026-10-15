import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { PlanWeek as Week } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import {
  dayLong,
  dayShort,
  isEmpty,
  PlanNotice,
  portionsLabel,
  weekday,
  weekRange,
  weekUrl,
  whenSet,
} from './plan';

/**
 * `/ukeplan?uke=2026-W43` (ST-1231, ST-1213 pictures 01, 02, 06): the household's dinners,
 * Monday to Sunday. Editors only (the route); the week is in the address so it can be shared
 * between phones. A week the API does not know (`?uke=2026-W54`) is the page-not-found.
 */
@Component({
  selector: 'app-plan-week',
  imports: [RouterLink, NotFound, ServerError],
  templateUrl: './plan-week.html',
  styleUrl: './ukeplan.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanWeek {
  /** The `uke` query parameter: "2026-W43", or blank for this week. */
  readonly uke = input<string>();

  private readonly week = httpResource<Week>(() => weekUrl(this.uke() ?? ''));
  protected readonly state = computed(() => {
    const error = this.week.error();
    if (error) return isBadWeek(error) ? 'not-found' : 'error';
    return this.week.hasValue() ? 'ready' : 'loading';
  });

  /** The line left by a day page ("Lapskaus ble flyttet …"), shown once. */
  protected readonly notice = inject(PlanNotice).take();

  protected readonly view = computed(() => {
    if (!this.week.hasValue()) return undefined;
    const week = this.week.value();
    const days = week.days.map((day) => ({
      ...day,
      label: dayShort(day.date),
      long: dayLong(day.date),
      today: day.date === week.today,
      empty: isEmpty(day),
      portions: day.portions ? portionsLabel(day.portions) : '',
    }));
    const empty = days.filter((day) => day.empty);
    return {
      week,
      days,
      when: `Uke ${String(week.number)} · ${weekRange(week.start, week.end)}`,
      planned: 7 - empty.length,
      emptyDays:
        empty.length === 7 ? 'hele uken' : empty.map((day) => weekday(day.date)).join(', '),
      changed:
        week.last_change_at && week.last_change_by
          ? `${week.last_change_by}, ${whenSet(week.last_change_at, week.today)}`
          : '',
    };
  });

  constructor() {
    inject(Title).setTitle('Ukeplan — food.st44.no');
  }
}

/** The API's 422 for a week that does not exist; anything else is S-500. */
function isBadWeek(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 422;
}
