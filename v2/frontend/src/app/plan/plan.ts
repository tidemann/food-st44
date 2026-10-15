import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { DinnerInput, PlanDay, PlanMove, PlanWeek } from '../api/types';

// The week plan (ST-1231). Dates travel as the API's "2026-10-22"; the words are Norwegian and
// written out here rather than by Intl, so a phone's locale cannot change them.

const MONTHS = [
  'januar',
  'februar',
  'mars',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'desember',
];
const SHORT_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'des',
];
const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

interface Parts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: string;
}

function parts(value: string): Parts {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return { year, month: month - 1, day, weekday: WEEKDAYS[date.getUTCDay()] ?? '' };
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Mandag 19. okt": the day's label in the week. */
export function dayShort(value: string): string {
  const d = parts(value);
  return `${capitalise(d.weekday)} ${String(d.day)}. ${SHORT_MONTHS[d.month] ?? ''}`;
}

/** "lørdag 24. oktober" */
export function dayLong(value: string): string {
  const d = parts(value);
  return `${d.weekday} ${String(d.day)}. ${MONTHS[d.month] ?? ''}`;
}

/** "lørdag" */
export function weekday(value: string): string {
  return parts(value).weekday;
}

/** "19.–25. oktober 2026", "26. oktober–1. november 2026", "28. desember 2026–3. januar 2027" */
export function weekRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  const tail = `${String(b.day)}. ${MONTHS[b.month] ?? ''} ${String(b.year)}`;
  if (a.year !== b.year)
    return `${String(a.day)}. ${MONTHS[a.month] ?? ''} ${String(a.year)}–${tail}`;
  if (a.month !== b.month) return `${String(a.day)}. ${MONTHS[a.month] ?? ''}–${tail}`;
  return `${String(a.day)}.–${tail}`;
}

/** When a day was set, as the facts say it: "i dag", "i går", or "19. oktober". */
export function whenSet(setAt: string, today: string): string {
  const day = localDate(setAt);
  if (day === today) return 'i dag';
  if (day === addDays(today, -1)) return 'i går';
  const d = parts(day);
  return `${String(d.day)}. ${MONTHS[d.month] ?? ''}`;
}

/** The date in Norway of a timestamp, "2026-10-22". */
function localDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(new Date(timestamp));
}

export function addDays(value: string, days: number): string {
  const d = parts(value);
  return new Date(Date.UTC(d.year, d.month, d.day + days)).toISOString().slice(0, 10);
}

/** "4 porsjoner", "1 porsjon" */
export function portionsLabel(portions: number): string {
  return `${String(portions)} ${portions === 1 ? 'porsjon' : 'porsjoner'}`;
}

/** What is on a day: the recipe's title or the short text; "" for an empty day. */
export function dinnerOf(day: PlanDay): string {
  return day.title || day.text;
}

export function isEmpty(day: PlanDay): boolean {
  return !day.title && !day.text;
}

/** "2026-10-22" is a real date. */
export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function weekUrl(week: string): string {
  return `/api/plan?week=${encodeURIComponent(week)}`;
}

/** The plan's writes. Reads go through httpResource on the pages. */
@Injectable({ providedIn: 'root' })
export class Plan {
  private readonly http = inject(HttpClient);

  week(week: string): Promise<PlanWeek> {
    return firstValueFrom(this.http.get<PlanWeek>(weekUrl(week)));
  }

  set(day: string, dinner: DinnerInput): Promise<PlanDay> {
    return firstValueFrom(this.http.put<PlanDay>(`/api/plan/${day}`, dinner));
  }

  clear(day: string): Promise<null> {
    return firstValueFrom(this.http.delete<null>(`/api/plan/${day}`));
  }

  move(day: string, to: string): Promise<PlanMove> {
    return firstValueFrom(this.http.post<PlanMove>(`/api/plan/${day}/move`, { to }));
  }
}

/** The line the week shows once after a change on a day page ("Lapskaus ble flyttet …"). */
@Injectable({ providedIn: 'root' })
export class PlanNotice {
  private readonly current = signal('');

  set(message: string): void {
    this.current.set(message);
  }

  /** The message, once: a reload or the next visit does not show it again. */
  take(): string {
    const message = this.current();
    this.current.set('');
    return message;
  }
}
