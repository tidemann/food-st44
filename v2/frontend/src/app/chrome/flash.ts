import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// The flash is only a query parameter, as in v1 (inventory §3.4): a reload shows it again, a
// copied link carries it, and any page that shows a flash accepts all three keys.
const MESSAGES: Readonly<Record<string, string>> = {
  created: 'Oppskriften ble lagret.',
  updated: 'Endringene ble lagret.',
  deleted: 'Oppskriften ble slettet.',
};

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
  readonly key = input<string | undefined>();

  protected readonly message = computed(() => {
    const key = this.key();
    return key !== undefined && Object.hasOwn(MESSAGES, key) ? MESSAGES[key] : undefined;
  });
}
