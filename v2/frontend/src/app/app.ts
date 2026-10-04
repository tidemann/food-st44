import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { formatMastheadDate, pluralise } from './recipes/format';
import { Site } from './site';

/** The chrome on every page (inventory §2.0): skip link, masthead, nav bar, footer. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly router = inject(Router);
  protected readonly site = inject(Site);

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

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  /** `href="#main"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected skip(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  /** GET / with `q`, as the v1 form did, but without a page load. Blank `q` is the front page. */
  protected search(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    const q = field.value.trim();
    void this.router.navigate(['/'], { queryParams: q ? { q } : {} });
  }
}
