import { HttpErrorResponse } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Recipe, RecipeInput, ValidationErrors } from '../api/types';
import { ALLOWED, cleanDescription, descriptionText, MAX_CHARS } from './description';
import { type Carried, failureOf } from './load';
import { PHOTO_NOT_SAVED, type PhotoChange, PhotoStepError, TOO_LARGE } from './photo';
import { PhotoField, type Rejected } from './photo-field';
import {
  blockFieldId,
  blockSummary,
  capitalise,
  type GroupBlock,
  groupName,
  groupsToEdit,
  groupsToSave,
  isBlockField,
  mergeGroups,
  mergePhases,
  move,
  newGroup,
  newPhase,
  type PhaseBlock,
  phaseName,
  phasesToEdit,
  phasesToSave,
  rowsFor,
} from './structure';
import { TagField } from './tag-field';

/**
 * The API's message per field (§3.2): title and ingredients, the photo (M3), porsjoner, the
 * description (ST-1937), and the fields of the groups and phases (ST-1962), keyed as the API
 * keys them ("ingredient_groups.1.title").
 */
export interface FieldErrors {
  title?: string;
  description?: string;
  ingredients?: string;
  servings?: string;
  photo?: string;
  blocks?: Partial<Record<string, string>>;
}

export function hasErrors(errors: FieldErrors): boolean {
  return !!(
    errors.title ??
    errors.description ??
    errors.ingredients ??
    errors.servings ??
    errors.photo ??
    Object.values(errors.blocks ?? {}).find(Boolean)
  );
}

/** What "Lagre" asks the page to save. */
export interface RecipeSave {
  recipe: RecipeInput;
  photo: PhotoChange;
}

export const EMPTY: RecipeInput = {
  title: '',
  ingredients: '',
  instructions: '',
  tags: [],
  servings: null,
  description: '',
};

/**
 * What a failed save means for the page: the field errors to show (a 422, or a 413 for the
 * photo), or S-404R / S-500. The rules live in the API; this only reads its answer.
 */
export function saveFailure(error: unknown): FieldErrors | 'not-found' | 'error' {
  if (error instanceof PhotoStepError) {
    // The recipe is saved, so a 403 or 5xx on the photo is the photo's error, not S-500.
    const failure = saveFailure(error.cause);
    return typeof failure === 'string' ? { photo: PHOTO_NOT_SAVED } : failure;
  }
  if (error instanceof HttpErrorResponse && (error.status === 422 || error.status === 413)) {
    // A 413 from nginx, before Django, is its own HTML page.
    const body = error.error as Partial<ValidationErrors> | string | null;
    const errors = typeof body === 'object' ? (body?.errors ?? {}) : {};
    const found: FieldErrors = {};
    if (errors['title']) found.title = errors['title'];
    if (errors['description']) found.description = errors['description'];
    if (errors['ingredients']) found.ingredients = errors['ingredients'];
    if (errors['servings']) found.servings = errors['servings'];
    if (errors['photo']) found.photo = errors['photo'];
    else if (error.status === 413) found.photo = TOO_LARGE;
    const blocks = Object.entries(errors).filter(([key]) => isBlockField(key));
    if (blocks.length) found.blocks = Object.fromEntries(blocks);
    // A 422 for no field the form has is not something the user can fix.
    return hasErrors(found) ? found : 'error';
  }
  return failureOf(error);
}

/** Which of the two block lists an action is on. */
type Kind = 'group' | 'phase';

/**
 * The recipe form shared by S-NEW and S-EDIT, with their error states (§2.7–2.10) and the photo
 * field (M3). The page owns the requests; this shows the fields, the API's errors and the busy
 * button (§3.5).
 *
 * ST-1962: the ingredients can be split into titled groups and the method into phases. A
 * recipe is one list and one method until the editor says otherwise ("Del opp i grupper");
 * "Slå sammen til én liste" undoes it, after asking, because the titles do not come back.
 */
@Component({
  selector: 'app-recipe-form',
  imports: [RouterLink, PhotoField, TagField],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeForm {
  /** The values the form starts from: empty for a new recipe, the stored ones for an edit. */
  readonly initial = input<RecipeInput | Recipe>(EMPTY);
  readonly errors = input<FieldErrors>({});
  /** The text was saved but the photo was not: the summary says so instead of "not saved". */
  readonly photoOnly = input(false);
  /** A save is in flight: the button is disabled and says "Lagrer…" (§3.5). */
  readonly busy = input(false);
  readonly submitLabel = input.required<string>();
  /** Where "Avbryt" goes. */
  readonly cancelLink = input.required<readonly (string | number)[]>();
  readonly cancelQuery = input<Carried>({});

  /** The values as typed, untrimmed, so they survive an error (§2.8), and the photo change. */
  readonly save = output<RecipeSave>();

  /** Only the fields the API takes, even when `initial` is a whole stored recipe. */
  protected readonly draft = linkedSignal<RecipeInput>(() => {
    const {
      title,
      ingredients,
      instructions,
      tags = [],
      servings = null,
      description,
    } = this.initial();
    return { title, ingredients, instructions, tags, servings, description };
  });
  /** The ingredient groups being edited (ST-1962), or null for one plain list. */
  protected readonly groups = linkedSignal(() => groupsToEdit(this.initial()));
  /** The method's phases being edited, or null for one plain method. */
  protected readonly phases = linkedSignal(() => phasesToEdit(this.initial()));
  /** "Slå sammen til én liste" was pressed and waits for its confirmation. */
  protected readonly merging = signal<Kind | null>(null);
  /** What the last move, removal, split or merge did, for a screen reader. */
  protected readonly status = signal('');
  protected readonly rowsFor = rowsFor;
  protected readonly groupName = groupName;
  protected readonly phaseName = phaseName;

  /** Beskrivelse (ST-1937): the tags it may use, its text length, and the preview. */
  protected readonly allowed = ALLOWED;
  protected readonly maxChars = MAX_CHARS;
  protected readonly descriptionLength = computed(
    () => descriptionText(this.draft().description).length,
  );
  protected readonly over = computed(() => this.descriptionLength() > MAX_CHARS);
  /** Cleaned as the server will clean it; Angular sanitises it once more when it is shown. */
  protected readonly preview = computed(() => cleanDescription(this.draft().description));
  protected readonly currentPhoto = computed(() => {
    const initial = this.initial();
    return 'photo_url' in initial ? initial.photo_url : null;
  });
  protected readonly photo = signal<PhotoChange>('keep');
  protected readonly rejected = signal<Rejected | null>(null);

  /** The page's errors, or the refused photo when "Lagre" was pressed with it showing. */
  protected readonly shown = linkedSignal(() => this.errors());
  protected readonly invalid = computed(() => hasErrors(this.shown()));
  /** The summary's lines for the groups' and phases' fields, each naming its block. */
  protected readonly blockErrors = computed(() =>
    Object.entries(this.shown().blocks ?? {}).flatMap(([key, message]) =>
      message
        ? [
            {
              id: blockFieldId(key),
              text: blockSummary(key, message, this.groups() ?? [], this.phases() ?? []),
            },
          ]
        : [],
    ),
  );
  /** Saves refused because a refused file was showing. */
  private readonly refused = signal(0);
  protected readonly summaryTitle = computed(() => {
    const rest = { ...this.shown() };
    delete rest.photo;
    return this.photoOnly() && !hasErrors(rest)
      ? 'Oppskriften er lagret, men ikke bildet'
      : 'Oppskriften ble ikke lagret';
  });

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly tagField = viewChild.required(TagField);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The field or button to focus once the blocks have been drawn again. */
  private readonly focusNext = signal<string | null>(null);

  constructor() {
    // Each failed save moves focus to the summary, as v1's autofocus did on every 400. The ring
    // shows too, as it did after v1's page load, although the save began with a click.
    // A save refused here, before any request, counts too; changing the photo does not.
    afterRenderEffect(() => {
      this.errors();
      this.refused();
      this.summary()?.nativeElement.focus({ focusVisible: true });
    });
    // After a block is added, moved or removed, focus goes where the editor's next step is.
    afterRenderEffect(() => {
      const id = this.focusNext();
      if (!id) return;
      this.byId(id)?.focus();
      this.focusNext.set(null);
    });
  }

  protected edit(
    field: 'title' | 'description' | 'ingredients' | 'instructions',
    value: string,
  ): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected editGroup(index: number, field: 'title' | 'ingredients', value: string): void {
    this.groups.update(
      (groups) =>
        groups?.map((group, at) => (at === index ? { ...group, [field]: value } : group)) ?? null,
    );
  }

  protected editPhase(
    index: number,
    field: 'title' | 'time' | 'instructions',
    value: string,
  ): void {
    this.phases.update(
      (phases) =>
        phases?.map((phase, at) => (at === index ? { ...phase, [field]: value } : phase)) ?? null,
    );
  }

  /** "Del opp i grupper" / "Del opp i faser": the list as it is becomes the first block. */
  protected split(kind: Kind): void {
    if (kind === 'group') {
      this.groups.set([newGroup(this.draft().ingredients)]);
      this.announce('Ingrediensene er nå gruppe 1. Gi gruppen en tittel.', 'group-0-title');
    } else {
      this.phases.set([newPhase(this.draft().instructions)]);
      this.announce('Fremgangsmåten er nå fase 1. Gi fasen en tittel.', 'phase-0-title');
    }
  }

  protected add(kind: Kind): void {
    const count = (kind === 'group' ? this.groups() : this.phases())?.length ?? 0;
    if (kind === 'group') this.groups.update((groups) => [...(groups ?? []), newGroup()]);
    else this.phases.update((phases) => [...(phases ?? []), newPhase()]);
    const word = kind === 'group' ? 'Gruppe' : 'Fase';
    this.announce(`${word} ${String(count + 1)} er lagt til.`, `${kind}-${String(count)}-title`);
  }

  /** "Flytt opp" / "Flytt ned". At either end the button is there but does nothing. */
  protected move(kind: Kind, index: number, by: -1 | 1): void {
    const blocks = kind === 'group' ? this.groups() : this.phases();
    const to = index + by;
    const block = blocks?.[index];
    if (!blocks || !block || to < 0 || to >= blocks.length) return;
    const name = this.nameOf(kind, block, index);
    if (kind === 'group') this.groups.update((groups) => groups && move(groups, index, by));
    else this.phases.update((phases) => phases && move(phases, index, by));
    const where = by < 0 ? 'opp' : 'ned';
    this.announce(
      `${capitalise(name)} er flyttet ${where}, til nummer ${String(to + 1)}.`,
      `${kind}-${String(to)}-${where}`,
    );
  }

  /** "Fjern". Removing the last group or phase is the plain list or method again. */
  protected remove(kind: Kind, index: number): void {
    const blocks = kind === 'group' ? this.groups() : this.phases();
    const block = blocks?.[index];
    if (!blocks || !block) return;
    const name = capitalise(this.nameOf(kind, block, index));
    const last = blocks.length === 1;
    if (kind === 'group') {
      this.groups.update((groups) =>
        last ? null : (groups?.filter((_, at) => at !== index) ?? null),
      );
      if (last) this.edit('ingredients', '');
    } else {
      this.phases.update((phases) =>
        last ? null : (phases?.filter((_, at) => at !== index) ?? null),
      );
      if (last) this.edit('instructions', '');
    }
    const field = kind === 'group' ? 'ingredients' : 'instructions';
    this.announce(`${name} er fjernet.`, last ? field : `${kind}-add`);
  }

  protected askMerge(kind: Kind): void {
    this.merging.set(kind);
    this.focusNext.set(`${kind}-merge-yes`);
  }

  protected cancelMerge(kind: Kind): void {
    this.merging.set(null);
    this.focusNext.set(`${kind}-merge`);
  }

  /** "Slå sammen": one list (or one method) again, in the blocks' order, without titles. */
  protected merge(kind: Kind): void {
    this.merging.set(null);
    if (kind === 'group') {
      this.edit('ingredients', mergeGroups(this.groups() ?? []));
      this.groups.set(null);
      this.announce('Gruppene er slått sammen til én liste.', 'ingredients');
    } else {
      this.edit('instructions', mergePhases(this.phases() ?? []));
      this.phases.set(null);
      this.announce('Fasene er slått sammen til én fremgangsmåte.', 'instructions');
    }
  }

  /** The API's message under a group's or a phase's field, if it has one. */
  protected blockError(kind: Kind, index: number, field: string): string | undefined {
    const list = kind === 'group' ? 'ingredient_groups' : 'phases';
    return this.shown().blocks?.[`${list}.${String(index)}.${field}`];
  }

  private nameOf(kind: Kind, block: GroupBlock | PhaseBlock, index: number): string {
    return kind === 'group'
      ? groupName(block as GroupBlock, index)
      : phaseName(block as PhaseBlock, index);
  }

  /**
   * Says what happened and moves focus on. The blocks' errors are by position, so after a
   * block moves they would point at the wrong one: they go until the next save.
   */
  private announce(message: string, focus: string): void {
    this.status.set(message);
    this.focusNext.set(focus);
    const { blocks, ...rest } = this.shown();
    if (blocks) this.shown.set(rest);
  }

  private byId(id: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  }

  /** Porsjoner (ST-1231): a blank field is "not given". */
  protected servingsChanged(value: string): void {
    const servings = Number.parseInt(value, 10);
    this.draft.update((draft) => ({
      ...draft,
      servings: Number.isNaN(servings) ? null : servings,
    }));
  }

  protected tagsChanged(tags: readonly string[]): void {
    this.draft.update((draft) => ({ ...draft, tags: [...tags] }));
  }

  /** A new photo or "Fjern bilde" answers the photo's error, so the summary drops it. */
  protected photoChanged(photo: PhotoChange): void {
    this.photo.set(photo);
    this.dropPhotoError();
  }

  /** "Fjern" by a refused file answers its error too. */
  protected rejectedChanged(rejected: Rejected | null): void {
    this.rejected.set(rejected);
    if (!rejected) this.dropPhotoError();
  }

  private dropPhotoError(): void {
    if (this.shown().photo) {
      const rest = { ...this.shown() };
      delete rest.photo;
      this.shown.set(rest);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    // A tag typed but not yet added with Enter is kept, not dropped.
    this.tagField().commit();
    // A refused file is still on screen: nothing is sent until it is replaced or removed.
    const rejected = this.rejected();
    if (rejected) {
      this.shown.set({ photo: rejected.message });
      this.refused.update((n) => n + 1);
      return;
    }
    // A plain list and a plain method send what they always sent; the API reads a missing
    // `ingredient_groups` or `phases` as none.
    const groups = this.groups();
    const phases = this.phases();
    const recipe: RecipeInput = {
      ...this.draft(),
      ...(groups && { ingredients: '', ingredient_groups: groupsToSave(groups) }),
      ...(phases && { instructions: '', phases: phasesToSave(phases) }),
    };
    this.save.emit({ recipe, photo: this.photo() });
  }

  /** `href="#title"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected jump(event: Event, field: HTMLElement | PhotoField): void {
    event.preventDefault();
    field.focus();
  }

  /** The same, for a group's or a phase's field, which has no template reference. */
  protected jumpTo(event: Event, id: string): void {
    event.preventDefault();
    this.byId(id)?.focus();
  }
}
