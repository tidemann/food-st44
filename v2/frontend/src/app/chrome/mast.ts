import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatMastheadDate, pluralise } from '../format';
import { Site } from '../site';

/**
 * The masthead of a Saturday supplement: a dated line, the wordmark with a crimson rule running
 * out of it to the edge, the search, then the nav bar (inventory §2.0).
 */
@Component({
  selector: 'app-mast',
  imports: [RouterLink],
  templateUrl: './mast.html',
  styleUrl: './mast.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mast {
  /** Which nav link is the current page. */
  readonly nav = input<'list' | 'new' | ''>('');
  /** On the front page the wordmark is the page heading. */
  readonly home = input(false);
  /** Echoed into the search field. */
  readonly q = input('');

  private readonly router = inject(Router);
  private readonly site = inject(Site);

  protected readonly today = formatMastheadDate(new Date());
  // Hidden only when the collection is known to be empty; shown while loading or on an error.
  protected readonly showSearch = computed(() => !this.site.known() || this.site.total() > 0);
  protected readonly count = computed(() =>
    this.site.known() && this.site.total() > 0
      ? `${pluralise(this.site.total(), 'oppskrift', 'oppskrifter')} i samlingen`
      : '',
  );

  protected search(event: SubmitEvent, field: HTMLInputElement): void {
    event.preventDefault();
    void this.router.navigate(['/'], { queryParams: { q: field.value } });
  }
}
