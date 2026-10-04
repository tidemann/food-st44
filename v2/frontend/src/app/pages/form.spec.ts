import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import type { RecipeInput, ValidationErrors } from '../api/types';
import { Page, recipe } from '../testing';

function type(page: Page, id: string, value: string): void {
  const field = page.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!field) throw new Error(`no #${id}`);
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

function submit(page: Page): void {
  page.el
    .querySelector('form.recipe-form')
    ?.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
}

const invalid = { status: 422, statusText: 'Unprocessable Entity' };

describe('Recipe form', () => {
  let page: Page;

  beforeEach(async () => {
    page = await Page.create();
  });

  afterEach(() => {
    page.http.verify();
  });

  it("shows the API's field errors like v1: summary, messages, aria, input kept", async () => {
    await page.go('/recipes/new');
    page.site().flush([]);
    await page.settle();
    expect(TestBed.inject(Title).getTitle()).toBe('Ny oppskrift — food.st44.no');

    type(page, 'title', '   ');
    type(page, 'ingredients', '600 g kjøttdeig');
    submit(page);
    await page.settle();

    const button = page.el.querySelector<HTMLButtonElement>('.recipe-form button[type=submit]');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.textContent.trim()).toBe('Lagrer…');

    const request = page.http.expectOne({ method: 'POST', url: '/api/recipes' });
    const sent: RecipeInput = { title: '   ', ingredients: '600 g kjøttdeig', instructions: '' };
    expect(request.request.body).toEqual(sent);
    const body: ValidationErrors = { errors: { title: 'Tittelen må fylles ut.' } };
    request.flush(body, invalid);
    await page.settle();

    const summary = page.el.querySelector<HTMLElement>('#error-summary');
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect(page.text('.alert-title')).toBe('Oppskriften ble ikke lagret');
    expect(page.all('#error-summary li a')).toEqual(['Tittelen må fylles ut.']);
    expect(page.text('#title-error')).toBe('Tittelen må fylles ut.');

    const title = page.el.querySelector<HTMLInputElement>('#title');
    expect(title?.getAttribute('aria-invalid')).toBe('true');
    expect(title?.getAttribute('aria-describedby')).toBe('title-error');
    expect(title?.value).toBe('   ');
    expect(page.el.querySelector('#ingredients')?.getAttribute('aria-invalid')).toBeNull();
    expect(page.el.querySelector('#ingredients-error')).toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.textContent.trim()).toBe('Lagre oppskrift');
    expect(TestBed.inject(Title).getTitle()).toBe('Feil — Ny oppskrift');

    page.el.querySelector<HTMLAnchorElement>('#error-summary a')?.click();
    expect(document.activeElement).toBe(title);
  });

  it('goes to the new recipe with the "created" flash', async () => {
    await page.go('/recipes/new');
    page.site().flush([]);
    await page.settle();

    type(page, 'title', 'Sveler');
    type(page, 'ingredients', '2 egg');
    submit(page);
    await page.settle();
    page.http.expectOne({ method: 'POST', url: '/api/recipes' }).flush(recipe(12, 'Sveler'));
    await page.settle();

    expect(page.url).toBe('/recipes/12?flash=created');
    page.site().flush([recipe(12, 'Sveler')]);
    page.http.expectOne('/api/recipes/12').flush(recipe(12, 'Sveler'));
    await page.settle();
    expect(page.text('.flash')).toBe('Oppskriften ble lagret.');
  });

  it('edits with both errors, then saves back to the recipe with the search kept', async () => {
    await page.go('/recipes/9/edit?q=saus');
    page.site().flush([recipe(9, 'Kjøttkaker')]);
    page.http.expectOne('/api/recipes/9').flush(recipe(9, 'Kjøttkaker'));
    await page.settle();

    expect(page.el.querySelector<HTMLInputElement>('#title')?.value).toBe('Kjøttkaker');
    expect(page.el.querySelector('.form-head a')?.getAttribute('href')).toBe('/recipes/9?q=saus');
    expect(page.text('.recipe-form button[type=submit]')).toBe('Lagre endringer');

    type(page, 'title', '');
    type(page, 'ingredients', '');
    submit(page);
    await page.settle();
    const both: ValidationErrors = {
      errors: { title: 'Tittelen må fylles ut.', ingredients: 'Skriv inn minst én ingrediens.' },
    };
    page.http.expectOne({ method: 'PUT', url: '/api/recipes/9' }).flush(both, invalid);
    await page.settle();

    expect(page.all('#error-summary li a')).toEqual([
      'Tittelen må fylles ut.',
      'Skriv inn minst én ingrediens.',
    ]);
    expect(page.el.querySelector('#ingredients')?.getAttribute('aria-describedby')).toBe(
      'ingredients-hint ingredients-error',
    );
    expect(TestBed.inject(Title).getTitle()).toBe('Feil — Rediger oppskrift');

    type(page, 'title', 'Kjøttkaker i brun saus');
    type(page, 'ingredients', '600 g kjøttdeig');
    submit(page);
    await page.settle();
    page.http
      .expectOne({ method: 'PUT', url: '/api/recipes/9' })
      .flush(recipe(9, 'Kjøttkaker i brun saus'));
    await page.settle();

    expect(page.url).toBe('/recipes/9?flash=updated&q=saus');
    page.site().flush([recipe(9, 'Kjøttkaker i brun saus')]);
    page.http.expectOne('/api/recipes/9').flush(recipe(9, 'Kjøttkaker i brun saus'));
    await page.settle();
    expect(page.text('.flash')).toBe('Endringene ble lagret.');
    expect(page.el.querySelector('.crumb a')?.getAttribute('href')).toBe('/?q=saus');
  });

  it('shows the error page when saving fails, with a retry back to the form', async () => {
    await page.go('/recipes/new');
    page.site().flush([]);
    await page.settle();

    type(page, 'title', 'Sveler');
    type(page, 'ingredients', '2 egg');
    submit(page);
    await page.settle();
    page.http
      .expectOne({ method: 'POST', url: '/api/recipes' })
      .flush(null, { status: 500, statusText: 'Server Error' });
    await page.settle();

    expect(page.text('main h1')).toBe('Noe gikk galt');
    expect(TestBed.inject(Title).getTitle()).toBe('Noe gikk galt — food.st44.no');
  });
});
