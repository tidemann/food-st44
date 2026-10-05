// Shared set-up for component tests: the real routes, a fake backend, and recipes from the
// inventory's seed data (§5B) so the tests read like the screenshots.
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ApiError, Me, Recipe } from '../app/api/types';
import { routes } from '../app/app.routes';
import { Auth } from '../app/auth';

const at = (day: string): string => `2026-${day}T10:00:00Z`;

/** Newest first, as the API returns them. */
export const SEED: Recipe[] = [
  {
    id: 9,
    title: 'Kjøttkaker i brun saus',
    ingredients: '600 g kjøttdeig av storfe\n1 liten løk, finrevet\n1 egg\nsalt og pepper',
    instructions: 'Bland kjøttdeig og salt.\n\nForm kaker og brun dem i smør.\n\nLa dem trekke.',
    created_at: at('10-02'),
  },
  {
    id: 8,
    title: 'Fårikål',
    ingredients: '1,5 kg fårikålkjøtt',
    instructions: 'Kok.',
    created_at: at('09-29'),
  },
  {
    id: 7,
    title: 'Pannekaker',
    ingredients: '3 egg\nen klype salt',
    instructions: '',
    created_at: at('09-25'),
  },
  {
    id: 6,
    title: 'Fiskegrateng',
    ingredients: '400 g torsk',
    instructions: 'Stek.',
    created_at: at('09-21'),
  },
  {
    id: 5,
    title: 'Pinnekjøtt',
    ingredients: '2 kg pinnekjøtt',
    instructions: 'Damp.',
    created_at: at('09-17'),
  },
  {
    id: 4,
    title: 'Lapskaus',
    ingredients: '500 g storfekjøtt',
    instructions: 'Kok.',
    created_at: at('09-13'),
  },
];

export function seed(id: number): Recipe {
  const recipe = SEED.find((r) => r.id === id);
  if (!recipe) throw new Error(`no seed recipe ${String(id)}`);
  return recipe;
}

/** Design row 2: Stig, on the household's editor list. The default in every test. */
export const EDITOR: Me = {
  signed_in: true,
  name: 'Stig',
  initial: 'S',
  is_editor: true,
  sign_in_available: true,
};
/** Design row 1: nobody signed in. */
export const READER: Me = {
  signed_in: false,
  name: '',
  initial: '',
  is_editor: false,
  sign_in_available: true,
};
/** Design row 3: a Google account that is not on the list. */
export const OUTSIDER: Me = {
  signed_in: true,
  name: 'kari.eksempel@gmail.com',
  initial: 'K',
  is_editor: false,
  sign_in_available: true,
};

/** What the fake backend answers. A number is an error status. */
export interface Answers {
  /** GET /api/auth/me (default: EDITOR). */
  me?: Me | number;
  /** GET /api/recipes, the whole collection (default: SEED). */
  all?: Recipe[] | number;
  /** GET /api/recipes?q=… */
  search?: Recipe[] | number;
  /** GET /api/recipes/:id */
  recipe?: Recipe | number;
}

export function setUp(): void {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter(routes, withComponentInputBinding()),
    ],
  });
}

function reply(
  http: HttpTestingController,
  match: (url: string, q: boolean) => boolean,
  body: Me | Recipe | Recipe[] | number,
  expect: boolean,
): void {
  const requests = http.match((r) => match(r.url, r.params.has('q')));
  if (expect && requests.length !== 1) {
    throw new Error(`expected one request, got ${String(requests.length)}`);
  }
  for (const request of requests) {
    if (typeof body === 'number') {
      const error: ApiError = { detail: 'Error' };
      request.flush(error, { status: body, statusText: 'Error' });
    } else {
      request.flush(body);
    }
  }
}

/**
 * Answers /api/auth/me. Call it before navigating: the routes to the forms wait for it, so a
 * navigation started first would never finish.
 */
export function signIn(me: Me | number = EDITOR): void {
  TestBed.inject(Auth);
  reply(TestBed.inject(HttpTestingController), (url) => url === '/api/auth/me', me, true);
}

/** Answers the requests in flight. The collection is only asked for when something uses Site. */
export function answer(answers: Answers): void {
  const http = TestBed.inject(HttpTestingController);
  TestBed.tick();
  reply(http, (url, q) => url === '/api/recipes' && !q, answers.all ?? SEED, false);
  if (answers.search !== undefined) {
    reply(http, (url, q) => url === '/api/recipes' && q, answers.search, true);
  }
  if (answers.recipe !== undefined) {
    reply(http, (url) => url.startsWith('/api/recipes/'), answers.recipe, true);
  }
}

/** Opens `url` in the real routes, answers the backend and lets the page render. */
export async function open(url: string, answers: Answers = {}): Promise<HTMLElement> {
  return page(await openHarness(url, answers));
}

/** Like `open`, but keeps the harness, for pages that navigate on their own (after a save). */
export async function openHarness(
  url: string,
  answers: Answers = {},
): Promise<RouterTestingHarness> {
  const harness = await RouterTestingHarness.create();
  signIn(answers.me);
  await harness.navigateByUrl(url);
  answer(answers);
  await harness.fixture.whenStable();
  return harness;
}

/** What the harness shows now. */
export function page(harness: RouterTestingHarness): HTMLElement {
  const el = harness.routeNativeElement;
  if (!el) throw new Error('nothing rendered');
  return el;
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function title(): string {
  return TestBed.inject(Title).getTitle();
}
