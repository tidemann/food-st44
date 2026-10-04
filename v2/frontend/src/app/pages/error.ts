import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';

/**
 * S-500, shown in place when the API fails. "Prøv på nytt" is a plain link to the address the
 * page is on, so it is a real reload: after a failed read that retries the read, after a failed
 * save it goes back to the form rather than re-sending it — v1's rule (inventory §2.14).
 */
@Component({
  selector: 'app-error-page',
  imports: [Mast, RouterLink],
  template: `
    <app-mast />
    <main id="main" tabindex="-1">
      <div class="wrap">
        <div class="notice">
          <div class="notice-rule"></div>
          <h1>Noe gikk galt</h1>
          <p>Prøv igjen om litt. Oppskriftene ligger trygt der de lå.</p>
          <div class="notice-actions">
            <a class="btn btn-lg" [href]="retryHref">Prøv på nytt</a>
            <a class="btn btn-lg" routerLink="/">Til alle oppskrifter</a>
          </div>
        </div>
      </div>
    </main>
  `,
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorPage {
  private readonly location = inject(DOCUMENT).location;
  protected readonly retryHref = this.location.pathname + this.location.search;

  constructor() {
    bindTitle(() => `Noe gikk galt — ${SITE}`);
  }
}
