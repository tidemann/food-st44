import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { ApiKeyCreated, ApiKeyInput, ValidationErrors } from '../api/types';
import { ServerError } from '../pages/server-error';
import { copier, mcpAddress } from './copy';

/** The limit the API enforces on a key's name (food.schemas.KEY_NAME_MAX_CHARS). */
export const KEY_NAME_MAX = 40;

/**
 * `/assistent/nokler/ny` (ST-833, design ST-818 §2): name the key, then see it once. The token
 * lives only in this component: a reload shows the empty form again, never the key.
 */
@Component({
  selector: 'app-assistant-key-new',
  imports: [RouterLink, ServerError],
  template: `
    @if (failed()) {
      <app-server-error />
    } @else {
      <div class="wrap">
        <div class="page">
          <div class="page-top">
            <p class="crumb">
              <a routerLink="/">Oppskrifter</a> /
              <a routerLink="/assistent">Koble til en assistent</a> /
              <a routerLink="/assistent/nokler">Nøkler</a> /
              <span aria-current="page">Ny nøkkel</span>
            </p>
          </div>
          @if (made(); as made) {
            <h1>Nøkkelen «{{ made.name }}» er laget</h1>
            <div class="alert" role="status">
              <p class="alert-title">Kopier nøkkelen nå</p>
              <p>
                Dette er eneste gangen den vises. Lukker du siden uten å kopiere, må du slette
                nøkkelen og lage en ny. Vi kan ikke hente den fram igjen.
              </p>
            </div>
            <div class="token">
              <p class="token-label">NØKKELEN</p>
              <code>{{ made.token }}</code>
              <button class="btn btn-primary" type="button" (click)="clip.copy(made.token)">
                {{ clip.copied() ? 'Kopiert' : 'Kopier nøkkelen' }}
              </button>
            </div>
            <section class="how">
              <h2>Slik bruker du den</h2>
              <div class="step">
                <span class="n">1</span>
                <p>
                  Lim nøkkelen inn der assistenten spør etter en nøkkel. Noen kaller det
                  <b>Authorization: Bearer</b>.
                </p>
              </div>
              <div class="step">
                <span class="n">2</span>
                <p>
                  Adressen den skal kobles til er <b>{{ address }}</b
                  >.
                </p>
              </div>
              <div class="step">
                <span class="n">3</span>
                <p>Del den aldri videre. Trenger noen andre tilgang, lager du en nøkkel til.</p>
              </div>
            </section>
            <div class="page-actions">
              <a class="btn btn-lg" routerLink="/assistent/nokler">Ferdig</a>
            </div>
          } @else {
            <h1>Ny nøkkel</h1>
            <p class="lead">
              Gi nøkkelen navnet til assistenten som skal bruke den, så vet du hvilken du skal
              slette siden.
            </p>
            <form class="key-form" novalidate (submit)="make($event, name)">
              <div class="field" [class.field-invalid]="error()">
                <label for="key-name">Navn på assistenten</label>
                <p class="field-hint" id="key-name-hint">
                  For eksempel «Samantha» eller «Claude på mobilen». Høyst 40 tegn.
                </p>
                <input
                  #name
                  id="key-name"
                  name="name"
                  type="text"
                  autocomplete="off"
                  [attr.maxlength]="max"
                  [attr.aria-invalid]="error() ? 'true' : null"
                  [attr.aria-describedby]="describedBy()"
                />
                @if (error(); as error) {
                  <p class="field-error" id="key-name-error">{{ error }}</p>
                }
              </div>
              <div class="page-actions">
                <button
                  class="btn btn-primary btn-lg"
                  type="submit"
                  [disabled]="busy()"
                  [attr.aria-busy]="busy() ? 'true' : null"
                >
                  Lag nøkkelen
                </button>
                <a class="btn btn-lg" routerLink="/assistent/nokler">Avbryt</a>
              </div>
            </form>
          }
        </div>
      </div>
    }
  `,
  styleUrls: ['../recipes/recipe-form.css', './assistant.css'],
  styles: `
    .key-form {
      max-width: 45.5rem;
      margin-top: 30px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantKeyNew {
  private readonly http = inject(HttpClient);

  protected readonly max = KEY_NAME_MAX;
  protected readonly address = mcpAddress();
  protected readonly clip = copier();

  protected readonly made = signal<ApiKeyCreated | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly describedBy = computed(() =>
    this.error() ? 'key-name-hint key-name-error' : 'key-name-hint',
  );

  constructor() {
    const title = inject(Title);
    effect(() => {
      const made = this.made();
      title.setTitle(
        made ? `Nøkkelen «${made.name}» er laget — food.st44.no` : 'Ny nøkkel — food.st44.no',
      );
    });
  }

  protected make(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    if (this.busy()) return;
    const name = field.value.trim();
    // The same rules as the API, so the common mistakes need no round trip.
    if (!name) {
      this.error.set('Gi nøkkelen et navn.');
      field.focus();
      return;
    }
    if (name.length > KEY_NAME_MAX) {
      this.error.set('Navnet kan være høyst 40 tegn.');
      field.focus();
      return;
    }
    this.error.set('');
    this.busy.set(true);
    const body: ApiKeyInput = { name };
    this.http.post<ApiKeyCreated>('/api/keys', body).subscribe({
      next: (made) => {
        this.busy.set(false);
        this.made.set(made);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const errors =
          error instanceof HttpErrorResponse && error.status === 422
            ? (error.error as ValidationErrors).errors
            : undefined;
        if (errors?.['name']) {
          this.error.set(errors['name']);
          field.focus();
        } else {
          this.failed.set(true);
        }
      },
    });
  }
}
