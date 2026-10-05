import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { Auth, SIGNED_OUT } from '../auth';

/**
 * M2 design row 3, "Ingen tilgang": a Google account that is not on the household list. Also
 * what a reader who is not signed in gets at /recipes/new or an edit or delete address: no form.
 */
@Component({
  selector: 'app-no-access',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="notice">
        <div class="notice-rule"></div>
        @if (me().signed_in) {
          <h1>Ingen tilgang</h1>
          <div class="signed-in-as">
            <span class="initial" aria-hidden="true">{{ me().initial }}</span>
            <p>
              <b>Innlogget som</b>&ngsp;
              <span>{{ me().name }}</span>
            </p>
          </div>
          <p>
            Kontoen du logget inn med står ikke på husstandslisten, så du kan ikke legge inn eller
            endre oppskrifter.
          </p>
          <p>
            Du kan lese alle oppskriftene som før. Skulle du hatt tilgang, be Stig legge til
            e-postadressen.
          </p>
          <div class="notice-actions">
            <a class="btn btn-primary btn-lg" routerLink="/">Les oppskriftene</a>
            <a class="btn btn-lg" [href]="signInHref">Logg inn med en annen konto</a>
          </div>
        } @else {
          <h1>Logg inn for å endre</h1>
          <p>
            Bare husstanden kan legge inn, endre og slette oppskrifter. Alle kan lese dem uten å
            logge inn.
          </p>
          <div class="notice-actions">
            <a class="btn btn-primary btn-lg" routerLink="/">Les oppskriftene</a>
            @if (me().sign_in_available) {
              <a class="btn btn-lg" [href]="signInHref">Logg inn</a>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .signed-in-as {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--tint);
      padding: 14px 16px;
      margin: 0 0 16px;
    }

    .signed-in-as p {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
      color: var(--soft);
      overflow-wrap: anywhere;
    }

    .signed-in-as b {
      display: block;
      font-weight: 600;
    }

    .signed-in-as .initial {
      width: 34px;
      height: 34px;
      font-size: 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoAccess {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly me = computed(() => this.auth.me() ?? SIGNED_OUT);
  /** Back to this same address after Google, so an editor lands on the form. */
  /** As a route it is built mid-navigation, when `router.url` is still the previous page. */
  protected readonly signInHref = this.auth.signInHref(
    this.router.currentNavigation()?.finalUrl ?? this.router.parseUrl(this.router.url),
  );

  constructor() {
    const title = inject(Title);
    effect(() => {
      title.setTitle(
        this.me().signed_in ? 'Ingen tilgang — food.st44.no' : 'Logg inn — food.st44.no',
      );
    });
  }
}
