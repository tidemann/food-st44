import { HttpClient } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import type { LinkImport, RecipeDraft, RecipeInput, TextImport } from '../api/types';
import { ServerError } from '../pages/server-error';
import { hostOf, type ImportSource, importFailure, LINK_URL, TEXT_URL } from './import';
import { newRecipe } from './new-recipe';
import { hasErrors, RecipeForm } from './recipe-form';

/**
 * Where the page is: entering the link or the text, fetching the page, checking the filled-in
 * form, or nothing to fill it with. Like M4's rows 7–10.
 */
type Step =
  | { kind: 'enter'; error?: string }
  | { kind: 'fetching' }
  | { kind: 'check'; draft: RecipeInput }
  | { kind: 'failed'; heading: string; lead: string };

/** What each source says. */
const WORDS = {
  link: {
    headline: 'Hent oppskrift fra lenke',
    intro: 'Lim inn lenken til en oppskrift på nettet. Vi henter den, du leser gjennom og lagrer.',
    tips: [
      'Mange oppskriftssider, som matprat.no, har oppskriften lagret i siden slik at den kan hentes.',
      'Bruk lenken til selve oppskriften, ikke til forsiden eller et søk.',
      'Virker ikke lenken, kan du kopiere teksten fra siden og lime den inn i stedet.',
    ],
    check:
      'Alt under er hentet fra siden og kan ha feil. Rett det som er galt — ingenting er lagret ennå.',
    none: {
      heading: 'Fant ingen oppskrift på siden',
      lead: 'Siden har ingen oppskrift vi kan lese. Ingenting er lagret. Kopier teksten fra siden og lim den inn, eller skriv inn oppskriften selv.',
    },
  },
  text: {
    headline: 'Lim inn oppskrift',
    intro:
      'Lim inn en oppskrift fra en annen app, en e-post eller et dokument. Vi deler den opp, du leser gjennom og lagrer.',
    tips: [
      'Ta med tittelen på første linje.',
      'Overskrifter som «Ingredienser» og «Fremgangsmåte» gjør det lettere å dele opp teksten.',
      'Én ingrediens per linje, med mengden først.',
    ],
    check:
      'Teksten er delt opp etter enkle regler, og noe kan ha havnet i feil felt. Rett det som er galt — ingenting er lagret ennå.',
    none: {
      heading: 'Fant ingen oppskrift i teksten',
      lead: 'Vi fant verken en tittel eller ingredienser. Ingenting er lagret.',
    },
  },
} as const;

/**
 * `/recipes/new/link` and `/recipes/new/text`: "Hent fra lenke" and "Lim inn tekst" (M5). The
 * API reads the page's recipe data or splits the text, with no AI; the editor checks the
 * filled-in form and nothing is saved before "Lagre oppskrift". Only matched for editors.
 */
@Component({
  selector: 'app-recipe-import',
  imports: [RecipeForm, RouterLink, ServerError],
  templateUrl: './recipe-import.html',
  styleUrls: [
    './form-page.css',
    './recipe-form.css',
    './recipe-from-photo.css',
    './recipe-import.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeImport {
  /** From the route's data. */
  readonly source = input.required<ImportSource>();

  private readonly http = inject(HttpClient);

  protected readonly saving = newRecipe();
  protected readonly step = signal<Step>({ kind: 'enter' });
  /** The link or the text as typed; kept when the editor goes back to change it. */
  protected readonly value = signal('');
  /** The text is split at once; the button says so meanwhile. */
  protected readonly busy = signal(false);

  protected readonly words = computed(() => WORDS[this.source()]);
  protected readonly host = computed(() => hostOf(this.value().trim()));
  protected readonly href = computed(() => {
    const url = this.value().trim();
    return url.includes('://') ? url : `https://${url}`;
  });

  /** Each step, narrowed for the template. */
  protected readonly enterError = computed(() => {
    const step = this.step();
    return step.kind === 'enter' ? (step.error ?? null) : null;
  });
  protected readonly checking = computed(() => {
    const step = this.step();
    return step.kind === 'check' ? step : null;
  });
  protected readonly failed = computed(() => {
    const step = this.step();
    return step.kind === 'failed' ? step : null;
  });
  protected readonly headline = computed(() => {
    const step = this.step();
    if (step.kind === 'check') return 'Les gjennom oppskriften';
    if (step.kind === 'failed') return step.heading;
    return this.words().headline;
  });

  private request: Subscription | null = null;
  /** Where focus goes when the step changes: the heading, or "Avbryt" while fetching. */
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly cancelButton = viewChild<ElementRef<HTMLElement>>('cancelButton');

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.saving.failed()) return;
      title.setTitle(
        this.checking() && hasErrors(this.saving.errors())
          ? `Feil — ${this.headline()}`
          : `${this.headline()} — food.st44.no`,
      );
    });
    // Not on arrival: the page loads like any other.
    let arrived = false;
    afterRenderEffect(() => {
      const target = this.step().kind === 'fetching' ? this.cancelButton() : this.heading();
      if (arrived) target?.nativeElement.focus();
      arrived = true;
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy() || this.step().kind === 'fetching') return;
    const source = this.source();
    const value = this.value();
    if (source === 'link') {
      const body: LinkImport = { url: value };
      this.step.set({ kind: 'fetching' });
      this.send(LINK_URL, body, 'url');
    } else {
      const body: TextImport = { text: value };
      this.busy.set(true);
      this.send(TEXT_URL, body, 'text');
    }
  }

  /** "Avbryt" while fetching: the request is dropped and the link can be changed. */
  protected cancel(): void {
    this.request?.unsubscribe();
    this.request = null;
    this.again();
  }

  /** "Bytt lenke", "Rett teksten", "Prøv en annen lenke": back to entering, value kept. */
  protected again(error?: string): void {
    this.step.set(error ? { kind: 'enter', error } : { kind: 'enter' });
  }

  private send(url: string, body: LinkImport | TextImport, field: 'url' | 'text'): void {
    this.request = this.http.post<RecipeDraft>(url, body).subscribe({
      next: ({ readable, title, ingredients, instructions }) => {
        this.done();
        this.step.set(
          readable
            ? { kind: 'check', draft: { title, ingredients, instructions } }
            : { kind: 'failed', ...this.words().none },
        );
      },
      error: (error: unknown) => {
        this.done();
        const failure = importFailure(error, field);
        if ('site' in failure) {
          this.step.set({
            kind: 'failed',
            heading: 'Fikk ikke hentet oppskriften',
            lead: failure.site,
          });
        } else {
          this.again(failure.field);
        }
      },
    });
  }

  private done(): void {
    this.request = null;
    this.busy.set(false);
  }
}
