import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
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
import { Router, RouterLink } from '@angular/router';
import type { ApiKey } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';

/**
 * `/assistent/nokler/:id/slett` (ST-833, design ST-818 §3): the confirm step before a key is
 * deleted. No JS confirm: this page is it. «Avbryt» first, the destructive action last.
 */
@Component({
  selector: 'app-assistant-key-delete',
  imports: [RouterLink, NotFound, ServerError],
  template: `
    @if (keys.error() || failed()) {
      <app-server-error />
    } @else if (keys.hasValue()) {
      @if (key(); as key) {
        <div class="wrap">
          <div class="notice">
            <div class="notice-rule"></div>
            <h1>Slett nøkkelen «{{ key.name }}»?</h1>
            <p>
              Assistenten mister tilgangen med en gang. Nøkkelen kan ikke hentes fram igjen —
              trenger du den senere, må du lage en ny.
            </p>
            <form class="notice-actions" (submit)="remove($event, key.id)">
              <a class="btn btn-lg" routerLink="/assistent/nokler">Avbryt</a>
              <button
                class="btn btn-danger btn-lg"
                type="submit"
                [disabled]="busy()"
                [attr.aria-busy]="busy() ? 'true' : null"
              >
                Slett nøkkelen
              </button>
            </form>
          </div>
        </div>
      } @else {
        <app-not-found />
      }
    }
  `,
  styleUrl: './assistant.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantKeyDelete {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  protected readonly keys = httpResource<ApiKey[]>(() => '/api/keys');
  protected readonly key = computed(() =>
    this.keys.hasValue()
      ? this.keys.value().find((key) => String(key.id) === this.id())
      : undefined,
  );
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    const title = inject(Title);
    effect(() => {
      const key = this.key();
      if (key) title.setTitle(`Slett nøkkelen «${key.name}»? — food.st44.no`);
    });
  }

  protected remove(event: Event, id: number): void {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.http.delete(`/api/keys/${String(id)}`).subscribe({
      // Already gone (deleted in another tab) ends in the same place.
      next: () => void this.router.navigate(['/assistent/nokler']),
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          void this.router.navigate(['/assistent/nokler']);
          return;
        }
        this.busy.set(false);
        this.failed.set(true);
      },
    });
  }
}
