// Emneord (ST-784): short lower-case words on a recipe, such as "middag" or "kake". The API is
// the rule (food/tags.py); these mirror it so the form shows a tag the way it will be stored.

/** The longest tag the API keeps (food.tags.MAX_CHARS). */
export const MAX_TAG = 24;

/** Trimmed, inner spaces collapsed, lower case, cut to MAX_TAG. '' when nothing is left. */
export function normaliseTag(name: string): string {
  return name.trim().split(/\s+/).join(' ').toLocaleLowerCase('nb').slice(0, MAX_TAG).trimEnd();
}

/** "middag" is shown as "Middag", as in the pictures; it is stored and linked in lower case. */
export function tagLabel(name: string): string {
  return name.charAt(0).toLocaleUpperCase('nb') + name.slice(1);
}

const collator = new Intl.Collator('nb');

/** Norwegian order: Æ, Ø, Å after Z. */
export function sortTags(names: readonly string[]): string[] {
  return [...names].sort((a, b) => collator.compare(a, b));
}

/** `?tag=` as the list reads it: '' when there is none. */
export function tagParam(tag: string | undefined): string {
  return normaliseTag(tag ?? '');
}
