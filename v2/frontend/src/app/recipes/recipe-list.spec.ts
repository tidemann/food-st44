import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Recipe } from '../api/types';
import { answer, open, page, seed, SEED, setUp, signIn, text, title } from '../../testing/app';

describe('RecipeList', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('S-LIST: the front page', () => {
    it('leads with the newest recipe', async () => {
      const el = await open('/');
      const lead = el.querySelector('.lead-plate');
      expect(text(lead?.querySelector('.kicker'))).toBe('Sist lagt inn');
      expect(lead?.querySelector('h2 a')?.getAttribute('href')).toBe('/recipes/9');
      expect(text(lead?.querySelector('h2'))).toBe('Kjøttkaker i brun saus');
      expect(text(lead?.querySelector('.lead-dek'))).toBe(
        '4 ingredienser, lagt inn 2. oktober 2026.',
      );
      expect(title()).toBe('food.st44.no — familiens oppskrifter');
    });

    it('shows the next three as "Nylig lagt inn"', async () => {
      const el = await open('/');
      const band = el.querySelector('.band:not(.index)');
      expect(text(band?.querySelector('.band-sub'))).toBe('De tre siste oppskriftene i samlingen.');
      const items = [...(band?.querySelectorAll('.sideitem') ?? [])];
      expect(items.map((a) => text(a.querySelector('h3')))).toEqual([
        'Fårikål',
        'Pannekaker',
        'Fiskegrateng',
      ]);
      expect(text(items[1]?.querySelector('.m'))).toBe('2 ingredienser · 25. sep');
    });

    it('lists the whole collection alphabetically, in nb order', async () => {
      const el = await open('/');
      const index = el.querySelector('.index');
      expect(text(index?.querySelector('.band-sub'))).toBe(
        'Alle 6 oppskriftene, i alfabetisk rekkefølge.',
      );
      expect([...(index?.querySelectorAll('li a') ?? [])].map((a) => text(a))).toEqual([
        'Fiskegrateng',
        'Fårikål',
        'Kjøttkaker i brun saus',
        'Lapskaus',
        'Pannekaker',
        'Pinnekjøtt',
      ]);
      expect(text(index?.querySelector('li .t'))).toBe('21. sep');
    });

    it('shows recipes 5 and on as cards, with no ?q= on any link', async () => {
      const el = await open('/');
      const cards = [...el.querySelectorAll('.more .card')];
      expect(cards.map((c) => text(c.querySelector('h3')))).toEqual(['Pinnekjøtt', 'Lapskaus']);
      expect(el.querySelector('.cards')?.getAttribute('data-cols')).toBe('2');
      expect(el.querySelector('a[href*="?q="]')).toBeNull();
    });

    it('drops the bands that one recipe cannot fill', async () => {
      const el = await open('/', { all: SEED.slice(0, 1) });
      expect(el.querySelector('.band:not(.index)')).toBeNull();
      expect(el.querySelector('.more')).toBeNull();
      expect(el.querySelector('.index')?.classList).toContain('index-first');
      expect(text(el.querySelector('.index .band-sub'))).toBe('Den ene oppskriften i samlingen.');
      expect(text(el.querySelector('.lead-dek'))).toBe('4 ingredienser, lagt inn 2. oktober 2026.');
    });
  });

  describe('S-SEARCH', () => {
    it('asks the API for the trimmed ?q= and lists the hits, carrying q', async () => {
      const hits = SEED.filter((r) => r.id === 9 || r.id === 5);
      const el = await open('/?q=%20kj%C3%B8tt%20', { search: hits });
      TestBed.inject(HttpTestingController).expectNone((r) => r.params.has('q'));

      expect(text(el.querySelector('.result-count'))).toBe('2 treff på «kjøtt»');
      expect(el.querySelector('.result-count')?.getAttribute('role')).toBe('status');
      expect(text(el.querySelector('h2.visually-hidden'))).toBe('Søkeresultater');
      expect(el.querySelector('.clear a')?.getAttribute('href')).toBe('/');
      const links = [...el.querySelectorAll('.hits a')].map((a) => a.getAttribute('href'));
      expect(links).toEqual(['/recipes/9?q=kj%C3%B8tt', '/recipes/5?q=kj%C3%B8tt']);
      expect(el.querySelector('.lead')).toBeNull();
      expect(el.querySelector('.index')).toBeNull();
      expect(title()).toBe('Søk: kjøtt — food.st44.no');
    });

    it('says "treff" for a single hit too', async () => {
      const el = await open('/?q=k%C3%A5l', { search: SEED.slice(1, 2) });
      expect(text(el.querySelector('.result-count'))).toBe('1 treff på «kål»');
    });

    it('treats a blank ?q= as the front page', async () => {
      const el = await open('/?q=%20%20');
      TestBed.inject(HttpTestingController).expectNone((r) => r.params.has('q'));
      expect(el.querySelector('.lead')).not.toBeNull();
      expect(title()).toBe('food.st44.no — familiens oppskrifter');
    });
  });

  describe('S-NOHITS', () => {
    it('offers the whole list when nothing matched', async () => {
      const el = await open('/?q=zzz', { search: [] });
      expect(text(el.querySelector('.notice h2'))).toBe('Ingen treff på «zzz»');
      expect(text(el.querySelector('.notice p'))).toBe(
        'Prøv et kortere søk, eller se alle oppskriftene.',
      );
      const button = el.querySelector('.notice .btn');
      expect(text(button)).toBe('Vis alle oppskrifter');
      expect(button?.getAttribute('href')).toBe('/');
      expect(title()).toBe('Søk: zzz — food.st44.no');
    });
  });

  describe('S-EMPTY', () => {
    it('invites the first recipe', async () => {
      const el = await open('/', { all: [] });
      expect(text(el.querySelector('.notice h2'))).toBe('Ingen oppskrifter ennå');
      expect(text(el.querySelector('.notice p'))).toBe(
        'Legg inn den første, så finner dere den igjen her.',
      );
      const button = el.querySelector('.notice .btn-primary');
      expect(text(button)).toBe('Legg til den første oppskriften');
      expect(button?.getAttribute('href')).toBe('/recipes/new');
    });

    it('wins over a search, which keeps its title', async () => {
      const el = await open('/?q=k%C3%A5l', { all: [], search: [] });
      expect(text(el.querySelector('.notice h2'))).toBe('Ingen oppskrifter ennå');
      expect(title()).toBe('Søk: kål — food.st44.no');
    });
  });

  describe('S-LISTERR', () => {
    it('says the search could not be loaded and retries the same search', async () => {
      const el = await open('/?q=saus', { search: 500 });
      const alert = el.querySelector('.alert');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert?.querySelector('.alert-title'))).toBe('Kunne ikke hente oppskriftene.');
      expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/?q=saus');
    });

    it('shows on the front page when the collection fails to load', async () => {
      const el = await open('/', { all: 500 });
      expect(el.querySelector('.alert')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('.alert a')?.getAttribute('href')).toBe('/');
    });
  });

  describe('ST-784: emneord', () => {
    const middag = SEED.filter((r) => r.tags.includes('middag'));

    /** Opens `url`, checks the one filtered request asks for `params`, and answers it. */
    async function filtered(url: string, params: Record<string, string>, hits: Recipe[]) {
      const harness = await RouterTestingHarness.create();
      signIn();
      await harness.navigateByUrl(url);
      TestBed.tick();
      const http = TestBed.inject(HttpTestingController);
      const request = http.expectOne((r) => r.url === '/api/recipes' && r.params.keys().length > 0);
      const asked = Object.fromEntries(
        request.request.params.keys().map((k) => [k, request.request.params.get(k)]),
      );
      expect(asked).toEqual(params);
      request.flush(hits);
      answer({});
      await harness.fixture.whenStable();
      return page(harness);
    }

    it('shows every tag in use with its count, each a link that filters on it', async () => {
      const el = await open('/');
      const band = el.querySelector('nav.tagband');
      expect(band?.getAttribute('aria-labelledby')).toBe('tagband-head');
      expect(text(band?.querySelector('h2'))).toBe('Emneord');
      const links = [...(band?.querySelectorAll('a') ?? [])];
      expect(links.map((a) => text(a.querySelector('.name')))).toEqual([
        'Fisk',
        'Høst',
        'Jul',
        'Kjøtt',
        'Middag',
        'Suppe',
      ]);
      expect(text(links[3])).toBe('Kjøtt 4 oppskrifter');
      expect(text(links[0])).toBe('Fisk 1 oppskrift');
      expect(links[3]?.getAttribute('href')).toBe('/?tag=kj%C3%B8tt');
      expect(el.querySelector('.tagband [aria-current]')).toBeNull();
    });

    it('has no band when no recipe has a tag', async () => {
      const el = await open('/', { tags: [] });
      expect(el.querySelector('.tagband')).toBeNull();
    });

    it('shows each recipe line with its tags, the first in red', async () => {
      const el = await open('/');
      const line = el.querySelector('.band .sideitem .m');
      expect(text(line)).toBe('Høst · Kjøtt · Middag 1 ingrediens · 29. sep');
      expect(text(line?.querySelector('.hot'))).toBe('Høst');
    });

    it('/?tag=middag lists only those recipes, the filtered tag red and marked', async () => {
      const el = await filtered('/?tag=Middag', { tag: 'middag' }, middag);
      expect(text(el.querySelector('.result-count'))).toBe('4 oppskrifter merket «middag»');
      expect(title()).toBe('Emneord: middag — food.st44.no');
      const clear = [...el.querySelectorAll('.clear a')];
      expect(clear.map(text)).toEqual(['Tøm filter']);
      expect(clear[0]?.getAttribute('href')).toBe('/');

      const hot = [...el.querySelectorAll('.hits .hot')].map(text);
      expect(hot).toEqual(['Middag', 'Middag', 'Middag', 'Middag']);
      expect(el.querySelector('.hits a')?.getAttribute('href')).toBe('/recipes/9?tag=middag');

      const on = el.querySelector('.tagband a[aria-current="true"]');
      expect(on?.classList).toContain('on');
      expect(text(on?.querySelector('.name'))).toBe('Middag');
      expect(on?.getAttribute('href')).toBe('/');
      expect(text(on)).toContain('valgt. Trykk for å vise alle.');
    });

    it('/?tag=middag&q=kylling combines the two, and each can be cleared alone', async () => {
      const hit = { ...seed(9), title: 'Kyllingfrikassé' };
      const el = await filtered('/?tag=middag&q=kylling', { q: 'kylling', tag: 'middag' }, [hit]);
      expect(text(el.querySelector('.result-count'))).toBe('1 treff på «kylling» merket «middag»');
      expect(title()).toBe('Søk: kylling, merket middag — food.st44.no');
      const clear = [...el.querySelectorAll('.clear a')];
      expect(clear.map(text)).toEqual(['Tøm søk', 'Tøm filter']);
      expect(clear.map((a) => a.getAttribute('href'))).toEqual(['/?tag=middag', '/?q=kylling']);
      // Another tag keeps the search; the one that is on clears to the search alone.
      const band = [...el.querySelectorAll('.tagband a')];
      expect(band[0]?.getAttribute('href')).toBe('/?q=kylling&tag=fisk');
      expect(el.querySelector('.tagband a.on')?.getAttribute('href')).toBe('/?q=kylling');
      expect(el.querySelector('.hits a')?.getAttribute('href')).toBe(
        '/recipes/9?q=kylling&tag=middag',
      );
    });

    it('says so when no recipe carries the tag', async () => {
      const el = await filtered('/?tag=ukjent', { tag: 'ukjent' }, []);
      expect(text(el.querySelector('.notice h2'))).toBe('Ingen oppskrifter merket «ukjent»');
      expect(text(el.querySelector('.notice p'))).toBe(
        'Velg et annet emneord, eller se alle oppskriftene.',
      );
    });

    it('offers to clear the filter when tag and search find nothing', async () => {
      const el = await filtered('/?tag=fisk&q=kake', { q: 'kake', tag: 'fisk' }, []);
      expect(text(el.querySelector('.notice h2'))).toBe('Ingen treff på «kake» merket «fisk»');
      const actions = [...el.querySelectorAll('.notice-actions a')];
      expect(actions.map((a) => a.getAttribute('href'))).toEqual(['/', '/?q=kake']);
    });

    it('retries the same filter after an error', async () => {
      const el = await open('/?tag=middag&q=saus', { search: 500 });
      expect(el.querySelector('.alert a')?.getAttribute('href')).toBe('/?q=saus&tag=middag');
    });
  });
});
