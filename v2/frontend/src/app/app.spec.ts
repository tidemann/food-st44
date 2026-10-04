import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { answer, type Answers, SEED, setUp, text, title } from '../testing/app';

let fixture: ComponentFixture<App>;

/** The whole app, chrome included, at `url`, with the backend answering `answers`. */
async function render(url: string, answers: Answers = {}): Promise<HTMLElement> {
  fixture = TestBed.createComponent(App);
  await TestBed.inject(Router).navigateByUrl(url);
  answer(answers);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('App chrome', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('has a skip link to main', async () => {
    const el = await render('/');
    const skip = el.querySelector('a.skip-link');
    expect(text(skip)).toBe('Hopp til innhold');
    const main = el.querySelector('main');
    expect(main?.id).toBe('main');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    (skip as HTMLAnchorElement).click();
    expect(document.activeElement).toBe(main);
  });

  it('makes the wordmark the page heading on the front page only', async () => {
    const el = await render('/');
    expect(text(el.querySelector('h1.wordmark'))).toBe('food.st44.no');
    expect(el.querySelector('.wordmark a')?.getAttribute('href')).toBe('/');

    await TestBed.inject(Router).navigateByUrl('/nonsens/bla');
    await fixture.whenStable();
    expect(el.querySelector('h1.wordmark')).toBeNull();
    expect(text(el.querySelector('p.wordmark'))).toBe('food.st44.no');
  });

  it('shows the count, the search and "Sist oppdatert" for a populated collection', async () => {
    const el = await render('/?q=saus', { search: [] });
    expect(text(el.querySelector('.count'))).toBe('6 oppskrifter i samlingen');
    const search = el.querySelector('form[role=search]');
    expect(search?.querySelector('input')?.value).toBe('saus');
    expect(search?.querySelector('input')?.placeholder).toBe('brun saus, kål, torsk …');
    expect([...el.querySelectorAll('.foot span')].map((s) => text(s))).toEqual([
      'food.st44.no — familiens oppskrifter',
      'Sist oppdatert 2. oktober 2026',
    ]);
  });

  it('says "1 oppskrift" for one', async () => {
    const el = await render('/', { all: SEED.slice(0, 1) });
    expect(text(el.querySelector('.count'))).toBe('1 oppskrift i samlingen');
  });

  it('hides the search, count and date when the collection is empty', async () => {
    const el = await render('/', { all: [] });
    expect(el.querySelector('form[role=search]')).toBeNull();
    expect(el.querySelector('.count')).toBeNull();
    expect(text(el.querySelector('.foot'))).toBe('food.st44.no — familiens oppskrifter');
  });

  it('keeps the search but drops the count when the collection cannot be loaded', async () => {
    const el = await render('/nonsens', { all: 500 });
    expect(el.querySelector('form[role=search]')).not.toBeNull();
    expect(el.querySelector('.count')).toBeNull();
  });

  it('marks "Oppskrifter" as the current page on the list, searched or not', async () => {
    const el = await render('/');
    const [list, add] = [...el.querySelectorAll('.mast-nav a')];
    expect(text(list)).toBe('Oppskrifter');
    expect(list?.getAttribute('aria-current')).toBe('page');
    expect(add?.getAttribute('href')).toBe('/recipes/new');
    expect(add?.hasAttribute('aria-current')).toBe(false);
  });

  it('searches through the router, trimming the query', async () => {
    const el = await render('/');
    const input = el.querySelector<HTMLInputElement>('#q');
    if (!input) throw new Error('no search field');
    input.value = '  kål ';
    el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    // Let the navigation run; the hits request it starts is answered below.
    await new Promise((resolve) => setTimeout(resolve));
    expect(TestBed.inject(Router).url).toBe('/?q=k%C3%A5l');
    answer({ search: [] });
    await fixture.whenStable();
  });

  describe('S-404P', () => {
    it('shows "Siden finnes ikke" for an unknown path', async () => {
      const el = await render('/nonsens/bla');
      expect(text(el.querySelector('main h1'))).toBe('Siden finnes ikke');
      expect(text(el.querySelector('main .notice p'))).toBe(
        'Lenken kan være skrevet feil. Alle oppskriftene ligger samlet på forsiden.',
      );
      expect(el.querySelector('main .notice .btn')?.getAttribute('href')).toBe('/');
      expect(title()).toBe('Siden finnes ikke — food.st44.no');
    });
  });
});
