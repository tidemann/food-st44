import { HttpErrorResponse, httpResource, HttpXsrfTokenExtractor } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap } from '@angular/router';
import type { ApiError, OAuthApproval } from '../api/types';
import { ServerError } from '../pages/server-error';

/** Where the form goes: django-oauth-toolkit's authorization endpoint (food/oauth.py). */
export const AUTHORIZE = '/api/oauth/authorize/';

/**
 * `/assistent/godkjenn` (ST-834, design ST-818 §5): the one approval step when the Claude app
 * signs in. The backend sends the browser here with the app's authorization request as the query,
 * after Google sign-in. «Tillat» and «Avvis» are a plain form posted to the authorization endpoint
 * (a full page load, CSRF-checked), which answers with the redirect back to the app.
 * An editor allows reading and writing; anyone else only reading.
 */
@Component({
  selector: 'app-assistant-approve',
  imports: [ServerError],
  template: `
    @if (approval.hasValue()) {
      @let shown = approval.value();
      <div class="wrap">
        <div class="page">
          <div class="page-top">
            <p class="crumb">{{ shown.client_name }} ber om tilgang</p>
          </div>
          @if (shown.can_write) {
            <h1>{{ shown.client_name }} vil lese og endre oppskrifter som deg</h1>
            <p class="lead">
              Sier du ja, kan {{ shown.client_name }} søke i samlingen, lese oppskrifter og legge
              inn eller rette dem i ditt navn.
            </p>
          } @else {
            <h1>{{ shown.client_name }} vil lese oppskrifter som deg</h1>
            <p class="lead">
              Sier du ja, kan {{ shown.client_name }} søke i samlingen og lese oppskrifter. Kontoen
              din er ikke redaktør, så {{ shown.client_name }} kan ikke endre noe.
            </p>
          }

          <div class="who-card">
            <span class="initial" aria-hidden="true">{{ shown.initial }}</span>
            <p>
              <b>{{ shown.name }}</b
              ><span class="who-mail">{{ shown.email }}</span>
            </p>
          </div>

          <div class="facts approve-facts">
            <h2>Dette sier du ja til</h2>
            <dl>
              <div>
                <dt>Søke og lese oppskrifter</dt>
                <dd>Ja</dd>
              </div>
              <div>
                <dt>Legge inn og endre</dt>
                <dd>{{ shown.can_write ? 'Ja' : 'Nei' }}</dd>
              </div>
              <div>
                <dt>Slette oppskrifter</dt>
                <dd>Nei</dd>
              </div>
            </dl>
          </div>

          <div class="note">
            <p>
              Alt {{ shown.client_name }} endrer, blir loggført med konto, tidspunkt og hva som ble
              endret. Du kan fjerne tilgangen igjen i Claude-appen. Svaret sendes til
              <b>{{ shown.client_host }}</b
              >.
            </p>
          </div>

          <form class="page-actions" method="post" action="/api/oauth/authorize/">
            <input type="hidden" name="csrfmiddlewaretoken" [value]="csrfToken()" />
            @for (field of fields(); track field.name) {
              <input type="hidden" [name]="field.name" [value]="field.value" />
            }
            <button class="btn btn-lg" type="submit">Avvis</button>
            <button class="btn btn-primary btn-lg" type="submit" name="allow" value="on">
              Tillat
            </button>
          </form>
        </div>
      </div>
    } @else if (problem(); as problem) {
      <div class="wrap">
        <div class="notice">
          <div class="notice-rule"></div>
          <h1>{{ problem.heading }}</h1>
          <p>{{ problem.detail }}</p>
          @if (problem.signIn) {
            <div class="notice-actions">
              <a class="btn btn-primary btn-lg" [href]="retry()">Logg inn med Google</a>
            </div>
          }
        </div>
      </div>
    } @else if (approval.error()) {
      <app-server-error />
    }
  `,
  styleUrl: './assistant.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantApprove {
  private readonly xsrf = inject(HttpXsrfTokenExtractor);
  /** The app's authorization request, exactly as it reached the backend. */
  private readonly query = queryOf(inject(ActivatedRoute).snapshot.queryParamMap);

  protected readonly approval = httpResource<OAuthApproval>(
    () => `/api/oauth/approval?${this.query}`,
  );
  protected readonly fields = computed(() =>
    this.approval.hasValue()
      ? Object.entries(this.approval.value().fields).map(([name, value]) => ({ name, value }))
      : [],
  );
  /** Read once the answer is in: the request that fetched it set the cookie. */
  protected readonly csrfToken = computed(() =>
    this.approval.hasValue() ? (this.xsrf.getToken() ?? '') : '',
  );
  /** Signed out since: the authorization request again, which goes through Google first. */
  protected readonly retry = computed(() => `${AUTHORIZE}?${this.query}`);
  /** A 401 or 400 the person can act on; anything else is the server-error page. */
  protected readonly problem = computed(() => {
    const error = this.approval.error();
    if (!(error instanceof HttpErrorResponse)) return undefined;
    const detail = (error.error as Partial<ApiError> | null)?.detail ?? '';
    if (error.status === 401) return { heading: 'Logg inn først', detail, signIn: true };
    if (error.status === 400) return { heading: 'Lenken virker ikke', detail, signIn: false };
    return undefined;
  });

  constructor() {
    const title = inject(Title);
    effect(() => {
      const name = this.approval.hasValue() ? this.approval.value().client_name : 'Claude';
      title.setTitle(`${name} ber om tilgang — food.st44.no`);
    });
  }
}

/** The query string again, without the `?`; a repeated parameter (`resource`) stays repeated. */
function queryOf(params: ParamMap): string {
  const search = new URLSearchParams();
  for (const key of params.keys) {
    for (const value of params.getAll(key)) search.append(key, value);
  }
  return search.toString();
}
