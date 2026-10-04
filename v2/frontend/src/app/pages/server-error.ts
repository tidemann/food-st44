import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';

/** S-500 (§2.14): a request for the page's data failed. */
@Component({
  selector: 'app-server-error',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="notice">
        <div class="notice-rule"></div>
        <h1>Noe gikk galt</h1>
        <p>Prøv igjen om litt. Oppskriftene ligger trygt der de lå.</p>
        <div class="notice-actions">
          <!-- A plain link, so "try again" really loads the page again. -->
          <a class="btn btn-lg" [href]="retryHref">Prøv på nytt</a>
          <a class="btn btn-lg" routerLink="/">Til alle oppskrifter</a>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerError {
  protected readonly retryHref = inject(Router).url;

  constructor() {
    inject(Title).setTitle('Noe gikk galt — food.st44.no');
  }
}
