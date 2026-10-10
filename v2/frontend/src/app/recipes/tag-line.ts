import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { tagLabel } from './tags';

/**
 * A recipe line's emneord, "Kjøtt · Middag", before its meta (ST-784). One tag is red, where the
 * signed-off picture has its red word: the filtered tag when there is one, else the first. Text,
 * not links: the whole line is already the recipe's link. Nothing at all for a recipe without.
 */
@Component({
  selector: 'app-tag-line',
  template: `
    @for (tag of shown(); track tag.name) {
      @if (!$first) {
        <span class="sep"> · </span>
      }
      <span [class.hot]="tag.hot">{{ tag.label }}</span>
    }
    @if (shown().length) {
      <span class="bar" aria-hidden="true"></span>&ngsp;
    }
  `,
  styleUrl: './tag-line.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagLine {
  readonly tags = input.required<readonly string[]>();
  /** The tag the list is filtered on, or ''. */
  readonly active = input('');

  protected readonly shown = computed(() => {
    const tags = this.tags();
    const hot = tags.includes(this.active()) ? this.active() : tags[0];
    return tags.map((name) => ({ name, label: tagLabel(name), hot: name === hot }));
  });
}
