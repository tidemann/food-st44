import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Me } from './api/types';
import { App } from './app';
import {
  answer,
  type Answers,
  EDITOR,
  OUTSIDER,
  READER,
  seed,
  setUp,
  signIn,
  text,
  title,
} from '../testing/app';

// M2, design rows 1–3: what a reader, an editor and an account that is not on the list see.

let fixture: ComponentFixture<App>;

async function render(url: string, answers: Answers = {}): Promise<HTMLElement> {
  fixture = TestBed.createComponent(App);
  signIn(answers.me);
  await TestBed.inject(Router).navigateByUrl(url);
  answer(answers);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const navLinks = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.mast-nav a, .mast-nav button')].map(text);
const who = (el: HTMLElement): string =>
  [...(el.querySelector('.who')?.children ?? [])].map(text).join(' ');
const signInLink = (el: HTMLElement, label: string): string | null | undefined =>
  [...el.querySelectorAll('a')].find((a) => text(a) === label)?.getAttribute('href');

const login = (next: string): string => `/api/auth/google/login?next=${encodeURIComponent(next)}`;

describe('Sign-in state (M2)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('row 1: not signed in', () => {
    const me = READER;

    it('shows only a small "Logg inn", back to this page', async () => {
      const el = await render('/recipes/9?q=saus&flash=updated', { me, recipe: seed(9) });
      expect(navLinks(el)).toEqual(['Oppskrifter', 'Logg inn']);
      expect(el.querySelector('.who .initial')).toBeNull();
      expect(signInLink(el, 'Logg inn')).toBe(login('/recipes/9?q=saus&login=ok'));
    });

    it('has no "Rediger", "Slett" or "Skriv den inn" on a recipe, and the recipe reads', async () => {
      const el = await render('/recipes/7', { me, recipe: seed(7) });
      expect(text(el.querySelector('main h1'))).toBe('Pannekaker');
      expect(el.querySelector('.acts')).toBeNull();
      expect(text(el.querySelector('.steps-none'))).toBe(
        'Ingen fremgangsmåte er skrevet inn ennå.',
      );
      expect(el.querySelector('main a[href$="/edit"], main a[href$="/delete"]')).toBeNull();
    });

    it('does not offer to add the first recipe', async () => {
      const el = await render('/', { me, all: [] });
      expect(el.querySelector('a[href="/recipes/new"]')).toBeNull();
      expect(text(el.querySelector('main .notice p'))).toBe(
        'Når husstanden legger inn oppskrifter, finner du dem her.',
      );
    });

    for (const url of ['/recipes/new', '/recipes/9/edit', '/recipes/9/delete']) {
      it(`gets no form at ${url}, but a way to sign in`, async () => {
        const el = await render(url, { me });
        expect(el.querySelector('form:not([role=search])')).toBeNull();
        expect(text(el.querySelector('main h1'))).toBe('Logg inn for å endre');
        expect(title()).toBe('Logg inn — food.st44.no');
        expect(signInLink(el.querySelector('main') ?? el, 'Logg inn')).toBe(
          login(`${url}?login=ok`),
        );
        expect(signInLink(el.querySelector('main') ?? el, 'Les oppskriftene')).toBe('/');
      });
    }

    it('hides "Logg inn" when sign-in is not set up', async () => {
      const el = await render('/', { me: { ...me, sign_in_available: false } });
      expect(el.querySelector('.who')).toBeNull();
      expect(navLinks(el)).toEqual(['Oppskrifter']);
    });

    it('is read-only when /api/auth/me fails', async () => {
      const el = await render('/recipes/new', { me: 500 });
      expect(el.querySelector('.who')).toBeNull();
      expect(el.querySelector('form:not([role=search])')).toBeNull();
      expect(text(el.querySelector('main h1'))).toBe('Logg inn for å endre');
    });

    it('says so when a sign-in failed', async () => {
      const el = await render('/?login=failed', { me });
      expect(text(el.querySelector('main .flash'))).toBe(
        'Innloggingen ble ikke fullført. Prøv igjen.',
      );
    });
  });

  describe('row 2: a signed-in editor', () => {
    const me = EDITOR;

    it('shows the initial, the name, "Logg ut" and "Ny oppskrift"', async () => {
      const el = await render('/', { me });
      expect(navLinks(el)).toEqual(['Oppskrifter', 'Ny oppskrift', 'Logg ut']);
      expect(text(el.querySelector('.who .initial'))).toBe('S');
      expect(who(el)).toBe('S Stig Logg ut');
    });

    it('has "Rediger" and "Slett" on a recipe', async () => {
      const el = await render('/recipes/9', { me, recipe: seed(9) });
      expect([...el.querySelectorAll('.acts a')].map(text)).toEqual(['Rediger', 'Slett']);
    });

    it('gets the form at /recipes/new', async () => {
      const el = await render('/recipes/new', { me });
      expect(text(el.querySelector('main h1'))).toBe('Ny oppskrift');
      expect(el.querySelector('main form')).not.toBeNull();
    });

    it('lands back on the page without ?login=ok', async () => {
      await render('/recipes/9?q=saus&login=ok', { me, recipe: seed(9) });
      await fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/recipes/9?q=saus');
    });

    it('signs out, and a form on screen gives way to "Logg inn for å endre"', async () => {
      const el = await render('/recipes/new', { me });
      el.querySelector<HTMLButtonElement>('.who-link')?.click();
      const http = TestBed.inject(HttpTestingController);
      const logout = http.expectOne('/api/auth/logout');
      expect(logout.request.method).toBe('POST');
      logout.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(navLinks(el)).toEqual(['Oppskrifter', 'Logg inn']);
      expect(el.querySelector('main form')).toBeNull();
      expect(text(el.querySelector('main h1'))).toBe('Logg inn for å endre');
    });
  });

  describe('row 3: signed in, not on the list', () => {
    const me: Me = OUTSIDER;

    it('shows the account and "Logg ut", but no "Ny oppskrift"', async () => {
      const el = await render('/', { me });
      expect(navLinks(el)).toEqual(['Oppskrifter', 'Logg ut']);
      expect(who(el)).toBe('K kari.eksempel@gmail.com Logg ut');
    });

    it('gets "Ingen tilgang" right after signing in', async () => {
      const el = await render('/recipes/9?login=ok', { me });
      expect(text(el.querySelector('main h1'))).toBe('Ingen tilgang');
      expect(title()).toBe('Ingen tilgang — food.st44.no');
      expect(text(el.querySelector('.signed-in-as p'))).toBe(
        'Innlogget som kari.eksempel@gmail.com',
      );
      expect([...el.querySelectorAll('main .notice p:not(.signed-in-as p)')].map(text)).toEqual([
        'Kontoen du logget inn med står ikke på husstandslisten, så du kan ikke legge inn eller endre oppskrifter.',
        'Du kan lese alle oppskriftene som før. Skulle du hatt tilgang, be Stig legge til e-postadressen.',
      ]);
      expect(signInLink(el, 'Les oppskriftene')).toBe('/');
      expect(signInLink(el, 'Logg inn med en annen konto')).toBe(login('/recipes/9?login=ok'));
    });

    it('still reads every recipe, without "Rediger" or "Slett"', async () => {
      const el = await render('/recipes/9', { me, recipe: seed(9) });
      expect(text(el.querySelector('main h1'))).toBe('Kjøttkaker i brun saus');
      expect(el.querySelector('.acts')).toBeNull();
    });

    for (const url of ['/recipes/new', '/recipes/9/edit', '/recipes/9/delete']) {
      it(`gets "Ingen tilgang" and no form at ${url}`, async () => {
        const el = await render(url, { me });
        expect(el.querySelector('form:not([role=search])')).toBeNull();
        expect(text(el.querySelector('main h1'))).toBe('Ingen tilgang');
      });
    }
  });
});
