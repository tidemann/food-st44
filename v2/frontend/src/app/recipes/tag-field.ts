import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Site } from '../site';
import { MAX_TAG, normaliseTag, tagLabel } from './tags';

/** At most this many tags in use are offered at once. */
const MAX_SUGGESTIONS = 6;

export interface Suggestion {
  name: string;
  label: string;
  /** How many recipes carry it, or null for a tag nobody has used yet. */
  count: number | null;
}

/**
 * "Emneord (valgfritt)" on the recipe form (ST-784): the tags as chips with "Fjern", and a field
 * that adds one on Enter, offering the tags in use while typing. A combobox in the ARIA pattern:
 * the arrow keys move through the suggestions, Enter takes the marked one, Escape closes them.
 */
@Component({
  selector: 'app-tag-field',
  templateUrl: './tag-field.html',
  styleUrl: './tag-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagField {
  private readonly site = inject(Site);

  /** The recipe's tags, as stored: lower case, in the order they were added. */
  readonly value = model<readonly string[]>([]);

  protected readonly max = MAX_TAG;
  protected readonly typed = signal('');
  /** The suggestion the arrow keys have marked. */
  protected readonly marked = signal(0);
  /** Escape closes the suggestions until the next keystroke. */
  private readonly dismissed = signal(false);
  /** Read out after an add or a remove. */
  protected readonly said = signal('');

  protected readonly chips = computed(() =>
    this.value().map((name) => ({ name, label: tagLabel(name) })),
  );

  protected readonly suggestions = computed<Suggestion[]>(() => {
    const wanted = normaliseTag(this.typed());
    if (!wanted) return [];
    const chosen = new Set(this.value());
    const inUse = this.site.tags.hasValue() ? this.site.tags.value() : [];
    const matches = inUse
      .filter(({ name }) => name.includes(wanted) && !chosen.has(name))
      // Those that start with what is typed first; each group stays in Norwegian order.
      .sort((a, b) => Number(!a.name.startsWith(wanted)) - Number(!b.name.startsWith(wanted)))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ name, count }) => ({ name, label: tagLabel(name), count }));
    const known = chosen.has(wanted) || inUse.some(({ name }) => name === wanted);
    return known ? matches : [...matches, { name: wanted, label: tagLabel(wanted), count: null }];
  });
  protected readonly open = computed(() => !this.dismissed() && this.suggestions().length > 0);
  protected readonly markedId = computed(() =>
    this.open() ? `tag-option-${String(this.marked())}` : null,
  );

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  focus(): void {
    this.field().nativeElement.focus();
  }

  /** Adds what is typed but not yet added, so "Lagre" never drops a tag half-entered. */
  commit(): void {
    this.add(this.typed());
  }

  protected input(text: string): void {
    // A comma ends a tag too, so a pasted "middag, kylling" becomes two.
    const parts = text.split(',');
    const rest = parts.pop() ?? '';
    for (const part of parts) this.add(part);
    this.typed.set(rest);
    this.field().nativeElement.value = rest;
    this.marked.set(0);
    this.dismissed.set(false);
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.suggestions().length;
    switch (event.key) {
      case 'Enter': {
        // Enter adds a tag; it never sends the form.
        event.preventDefault();
        const marked = this.open() ? this.suggestions()[this.marked()] : undefined;
        this.add(marked ? marked.name : this.typed());
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp':
        if (!count) return;
        event.preventDefault();
        if (this.dismissed()) {
          this.dismissed.set(false);
          return;
        }
        this.marked.update((i) => (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
        break;
      case 'Escape':
        if (!this.open()) return;
        event.preventDefault();
        this.dismissed.set(true);
        break;
    }
  }

  protected pick(suggestion: Suggestion): void {
    this.add(suggestion.name);
    this.focus();
  }

  protected remove(name: string): void {
    this.value.update((tags) => tags.filter((tag) => tag !== name));
    this.said.set(`${tagLabel(name)} er fjernet.`);
    this.focus();
  }

  private add(text: string): void {
    const name = normaliseTag(text);
    this.typed.set('');
    this.field().nativeElement.value = '';
    this.marked.set(0);
    if (!name) return;
    if (!this.value().includes(name)) {
      this.value.update((tags) => [...tags, name]);
    }
    this.said.set(`${tagLabel(name)} er lagt til.`);
  }
}
