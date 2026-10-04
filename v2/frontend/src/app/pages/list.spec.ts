import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Page, recipe } from '../testing';

const collection = [
  recipe(9, 'Kjøttkaker i brun saus'),
  recipe(8, 'Fårikål'),
  recipe(7, 'Pannekaker', { instructions: '' }),
  recipe(6, 'Fiskegrateng'),
  recipe(5, 'Pinnekjøtt'),
  recipe(4, 'Lapskaus'),
];

describe('ListPage', () => {
  let page: Page;

  beforeEach(async () => {
    page = await Page.create();
  });

  afterEach(() => {
    page.http.verify();
  });

  it('lays out the front page: lead, newest three, register, the rest', async () => {
    await page.go('/');
    page.site().flush(collection);
    await page.settle();

    expect(TestBed.inject(Title).getTitle()).toBe('food.st44.no — familiens oppskrifter');
    expect(page.text('h1.wordmark')).toBe('food.st44.no');
    expect(page.text('.lead-link')).toBe('Kjøttkaker i brun saus');
    expect(page.text('.lead-dek')).toBe('3 ingredienser, lagt inn 19. september 2026.');
    expect(page.all('.band .side-title')).toEqual(['Fårikål', 'Pannekaker', 'Fiskegrateng']);
    expect(page.text('.band-sub')).toBe('De tre siste oppskriftene i samlingen.');
    // nb collation: å sorts after z, so "Få…" comes after "Fi…" (plain a-ordering would flip them).
    expect(page.all('.index-link')).toEqual([
      'Fiskegrateng',
      'Fårikål',
      'Kjøttkaker i brun saus',
      'Lapskaus',
      'Pannekaker',
      'Pinnekjøtt',
    ]);
    expect(page.all('.card-title')).toEqual(['Pinnekjøtt', 'Lapskaus']);
    expect(page.text('.count')).toBe('6 oppskrifter i samlingen');
  });

  it('searches through the API and links hits with the search carried on', async () => {
    await page.go('/?q=%20kj%C3%B8tt%20');
    page.site().flush(collection);
    page.search('kjøtt').flush([collection[0], collection[4]]);
    await page.settle();

    expect(TestBed.inject(Title).getTitle()).toBe('Søk: kjøtt — food.st44.no');
    expect(page.text('.result-count')).toBe('2 treff på «kjøtt»');
    expect(page.el.querySelector('.result-count')?.getAttribute('role')).toBe('status');
    expect(page.all('.hits .side-title')).toEqual(['Kjøttkaker i brun saus', 'Pinnekjøtt']);
    expect(page.el.querySelector('.hits a')?.getAttribute('href')).toBe('/recipes/9?q=kj%C3%B8tt');
    expect(page.el.querySelector<HTMLInputElement>('#q')?.value).toBe('kjøtt');
    expect(page.el.querySelector('.lead')).toBeNull();
  });

  it('says so when a search finds nothing', async () => {
    await page.go('/?q=zzz');
    page.site().flush(collection);
    page.search('zzz').flush([]);
    await page.settle();

    expect(page.text('.notice h2')).toBe('Ingen treff på «zzz»');
    expect(page.el.querySelector('.notice a')?.getAttribute('href')).toBe('/');
  });

  it('shows the empty collection, even for a search, and hides the search field', async () => {
    await page.go('/?q=k%C3%A5l');
    page.site().flush([]);
    page.search('kål').flush([]);
    await page.settle();

    expect(page.text('.notice h2')).toBe('Ingen oppskrifter ennå');
    expect(page.el.querySelector('form[role=search]')).toBeNull();
    expect(page.el.querySelector('.count')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Søk: kål — food.st44.no');
  });

  it('shows an alert with a retry link when the list cannot be loaded', async () => {
    await page.go('/?q=saus');
    page.site().flush(collection);
    page.search('saus').flush(null, { status: 500, statusText: 'Server Error' });
    await page.settle();

    expect(page.text('[role=alert] .alert-title')).toBe('Kunne ikke hente oppskriftene.');
    expect(page.el.querySelector('[role=alert] a')?.getAttribute('href')).toBe('/?q=saus');
  });

  it('shows the flash from ?flash=, and nothing for an unknown key', async () => {
    await page.go('/?flash=deleted');
    page.site().flush(collection);
    await page.settle();
    expect(page.text('.flash')).toBe('Oppskriften ble slettet.');

    await page.go('/?flash=nonsense');
    expect(page.el.querySelector('.flash')).toBeNull();
  });

  it('submits the masthead search to /?q=', async () => {
    await page.go('/');
    page.site().flush(collection);
    await page.settle();

    const field = page.el.querySelector<HTMLInputElement>('#q');
    if (!field) throw new Error('no search field');
    field.value = 'kål';
    field.form?.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
    await page.settle();
    page.search('kål').flush([collection[1]]);
    await page.settle();

    expect(page.url).toBe('/?q=k%C3%A5l');
    expect(page.text('.result-count')).toBe('1 treff på «kål»');
  });
});
