import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth, LOGIN_PARAM, withQuery } from './auth';
import { NoAccess } from './pages/no-access';
import { formatMastheadDate, pluralise } from './recipes/format';
import { Site } from './site';

/** The chrome on every page (inventory §2.0): skip link, masthead, nav bar, footer. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NoAccess],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly router = inject(Router);
  protected readonly site = inject(Site);
  protected readonly auth = inject(Auth);

  protected readonly today = formatMastheadDate();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url)),
    ),
  );
  /** On the front page the wordmark is the page heading. */
  protected readonly home = computed(() => {
    const url = this.url();
    return url !== undefined && url.root.children['primary'] === undefined;
  });
  /** The search on screen, echoed back into the field. */
  protected readonly q = computed(() => {
    const q: unknown = this.url()?.queryParams['q'];
    return this.home() && typeof q === 'string' ? q : '';
  });
  protected readonly count = computed(() =>
    pluralise(this.site.total(), 'oppskrift', 'oppskrifter'),
  );

  /** `?login=ok` or `?login=failed`, set by the backend at the end of a Google sign-in. */
  protected readonly login = computed(() => {
    const login: unknown = this.url()?.queryParams[LOGIN_PARAM];
    return typeof login === 'string' ? login : '';
  });
  protected readonly signInHref = computed(() => {
    const url = this.url();
    return url ? this.auth.signInHref(url) : '/api/auth/google/login';
  });
  /**
   * Right after a sign-in: "Ingen tilgang" for an account that is not on the list (design row
   * 3), and nothing at all until we know, so the page underneath does not flash past.
   */
  protected readonly page = computed<'page' | 'denied' | 'wait'>(() => {
    if (this.login() !== 'ok') return 'page';
    const me = this.auth.me();
    if (me === undefined) return 'wait';
    return me.signed_in && !me.is_editor ? 'denied' : 'page';
  });

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  constructor() {
    // An editor is simply back where they were: drop `?login=ok` so a reload or a copied link
    // does not carry it.
    effect(() => {
      const url = this.url();
      if (!url || this.login() !== 'ok' || !this.auth.isEditor()) return;
      const clean = withQuery(this.router, url, { [LOGIN_PARAM]: null });
      void this.router.navigateByUrl(clean, { replaceUrl: true });
    });
  }

  /** `href="#main"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected skip(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  /**
   * GET / with `q`, as the v1 form did, but without a page load. Blank `q` is the front page.
   * A search on a filtered list stays inside the filter (`?tag=`, ST-784).
   */
  protected search(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    const q = field.value.trim();
    const tag: unknown = this.home() ? this.url()?.queryParams['tag'] : undefined;
    void this.router.navigate(['/'], {
      queryParams: { ...(q ? { q } : {}), ...(typeof tag === 'string' && tag ? { tag } : {}) },
    });
  }

  /** Signs out and runs the route again, so a form on screen gives way to NoAccess. */
  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl(this.router.url, { onSameUrlNavigation: 'reload' });
  }
}
