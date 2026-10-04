import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Page, recipe } from '../testing';

describe('Delete flow', () => {
  let page: Page;

  beforeEach(async () => {
    page = await Page.create();
  });

  afterEach(() => {
    page.http.verify();
  });

  it('asks on a page of its own, deletes, and lands on the list with the flash', async () => {
    const kjottkaker = recipe(9, 'Kjøttkaker i brun saus');
    await page.go('/recipes/9/delete?q=saus');
    page.site().flush([kjottkaker]);
    page.http.expectOne('/api/recipes/9').flush(kjottkaker);
    await page.settle();

    expect(TestBed.inject(Title).getTitle()).toBe('Slett «Kjøttkaker i brun saus»? — food.st44.no');
    expect(page.text('main h1')).toBe('Slett «Kjøttkaker i brun saus»?');
    expect(page.el.querySelector('.notice-actions a')?.getAttribute('href')).toBe(
      '/recipes/9?q=saus',
    );

    page.el.querySelector<HTMLButtonElement>('.notice-actions button')?.click();
    await page.settle();
    expect(page.el.querySelector<HTMLButtonElement>('.notice-actions button')?.disabled).toBe(true);
    page.http.expectOne({ method: 'DELETE', url: '/api/recipes/9' }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await page.settle();

    // The search is dropped (inventory §3.3).
    expect(page.url).toBe('/?flash=deleted');
    page.site().flush([]);
    await page.settle();
    expect(page.text('.flash')).toBe('Oppskriften ble slettet.');
    expect(page.text('.notice h2')).toBe('Ingen oppskrifter ennå');
  });

  it('shows the recipe 404 when the recipe is already gone', async () => {
    await page.go('/recipes/9/delete');
    page.site().flush([]);
    page.http.expectOne('/api/recipes/9').flush(
      { detail: 'Not Found' },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
    await page.settle();

    expect(page.text('main h1')).toBe('Fant ikke oppskriften');
    expect(TestBed.inject(Title).getTitle()).toBe('Fant ikke oppskriften — food.st44.no');
  });
});

describe('Recipe page and not-found pages', () => {
  let page: Page;

  beforeEach(async () => {
    page = await Page.create();
  });

  afterEach(() => {
    page.http.verify();
  });

  it('shows amounts, numbered steps and the search-carrying actions', async () => {
    const lapskaus = recipe(4, 'Lapskaus', {
      ingredients: '\n500 g storfekjøtt\n6 poteter\nsalt og pepper',
      instructions: '1. Skjær alt i terninger.\n2. Kok.',
    });
    await page.go('/recipes/4?q=lap&flash=updated');
    page.site().flush([lapskaus]);
    page.http.expectOne('/api/recipes/4').flush(lapskaus);
    await page.settle();

    expect(TestBed.inject(Title).getTitle()).toBe('Lapskaus — food.st44.no');
    expect(page.text('.flash')).toBe('Endringene ble lagret.');
    expect(page.all('.ing li b')).toEqual(['500 g', '6']);
    expect(page.all('.ing li.li-plain')).toEqual(['salt og pepper']);
    expect(page.all('.step p')).toEqual(['Skjær alt i terninger.', 'Kok.']);
    expect(page.all('.rmeta dd')).toEqual(['3', '2 steg', '14. september 2026']);
    expect(page.all('.acts a').length).toBe(2);
    expect(page.el.querySelector('.acts a')?.getAttribute('href')).toBe('/recipes/4/edit?q=lap');
    expect(page.el.querySelector('.rhero img')?.getAttribute('alt')).toBe('Lapskaus');
  });

  it('treats an id that is not a positive number as a missing recipe, without asking', async () => {
    await page.go('/recipes/abc');
    page.site().flush([]);
    await page.settle();
    expect(page.text('main h1')).toBe('Fant ikke oppskriften');
  });

  it('has a page 404 for any other address', async () => {
    await page.go('/nonsens/bla');
    page.site().flush([]);
    await page.settle();
    expect(page.text('main h1')).toBe('Siden finnes ikke');
    expect(TestBed.inject(Title).getTitle()).toBe('Siden finnes ikke — food.st44.no');
  });
});
