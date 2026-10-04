import { effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

/** Keeps the tab title in step with a page. `null` leaves it alone (still loading). */
export function bindTitle(title: () => string | null): void {
  const service = inject(Title);
  effect(() => {
    const value = title();
    if (value !== null) service.setTitle(value);
  });
}

export const SITE = 'food.st44.no';
