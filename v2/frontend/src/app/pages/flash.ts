import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// The flash is only a query parameter, so a reload shows it again and a copied link carries it.
// Only these three keys say anything, on any page that has a flash (§3.4).
const MESSAGES: Partial<Record<string, string>> = {
  created: 'Oppskriften ble lagret.',
  updated: 'Endringene ble lagret.',
  deleted: 'Oppskriften ble slettet.',
};

/** The `?flash=` line under the nav after a create, edit or delete (§2.0, §3.3). */
@Component({
  selector: 'app-flash',
  template: `
    @if (message(); as message) {
      <div class="wrap">
        <p class="flash" role="status">{{ message }}</p>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Flash {
  /** The `flash` query parameter. */
  readonly key = input<string>();
  protected readonly message = computed(() => {
    const key = this.key();
    return key !== undefined && Object.hasOwn(MESSAGES, key) ? MESSAGES[key] : undefined;
  });
}
