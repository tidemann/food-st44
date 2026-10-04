import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { RouterLink, type Params } from '@angular/router';
import type { RecipeInput, ValidationErrors } from '../api/types';

/** Field name → message, as the API's 422 sends it (inventory §3.2). */
export type FieldErrors = ValidationErrors['errors'];

/**
 * The form for new and edit (S-NEW, S-EDIT and their error states): one template, two modes.
 * Validation is the API's; this shows what it says, next to the field and in a summary.
 */
@Component({
  selector: 'app-recipe-form',
  imports: [RouterLink],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeForm {
  readonly mode = input.required<'new' | 'edit'>();
  readonly initial = input<RecipeInput>({ title: '', ingredients: '', instructions: '' });
  readonly errors = input<FieldErrors>({});
  /** True while the request is out: the button is disabled and says "Lagrer…" (§3.5). */
  readonly saving = input(false);
  readonly cancelLink = input.required<string[]>();
  readonly cancelParams = input<Params>({});

  readonly save = output<RecipeInput>();

  // Kept as typed, untrimmed, also after a 422 (§2.8). The API trims what it stores.
  protected readonly title = linkedSignal(() => this.initial().title);
  protected readonly ingredients = linkedSignal(() => this.initial().ingredients);
  protected readonly instructions = linkedSignal(() => this.initial().instructions);

  protected readonly titleError = computed(() => this.errors()['title']);
  protected readonly ingredientsError = computed(() => this.errors()['ingredients']);
  protected readonly submitLabel = computed(() =>
    this.mode() === 'edit' ? 'Lagre endringer' : 'Lagre oppskrift',
  );

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly injector = inject(Injector);

  constructor() {
    // Each new set of errors moves focus to the summary, as v1's autofocus did on every 400.
    effect(() => {
      if (this.titleError() === undefined && this.ingredientsError() === undefined) return;
      afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
    });
  }

  protected submit(event: SubmitEvent): void {
    event.preventDefault();
    if (this.saving()) return;
    this.save.emit({
      title: this.title(),
      ingredients: this.ingredients(),
      instructions: this.instructions(),
    });
  }

  // The summary links are in-page anchors; with <base href="/"> a plain #title would navigate.
  protected focusField(event: Event, field: HTMLElement): void {
    event.preventDefault();
    field.focus();
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
}
