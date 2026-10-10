import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Recipe } from '../api/types';
import { answer, open, openHarness, page, setUp, text, title } from '../../testing/app';
import { field, fill, navigation, reject, submit, submitButton } from '../../testing/form';

const TITLE_ERROR = 'Tittelen må fylles ut.';
const INGREDIENTS_ERROR = 'Skriv inn minst én ingrediens.';

describe('RecipeNew', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('S-NEW', () => {
    it('shows the empty form', async () => {
      const el = await open('/recipes/new');
      expect(title()).toBe('Ny oppskrift — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Ny oppskrift');
      expect(text(el.querySelector('.form-head p'))).toBe(
        'Tittel og ingredienser må fylles ut. Resten kan du legge til siden.',
      );
      expect([...el.querySelectorAll('label')].map(text)).toEqual([
        'Tittel',
        'Emneord (valgfritt)',
        'Ingredienser',
        'Fremgangsmåte (valgfritt)',
      ]);
      expect(field(el, 'ingredients').getAttribute('rows')).toBe('10');
      expect(field(el, 'instructions').getAttribute('rows')).toBe('12');
      expect(field(el, 'ingredients').getAttribute('aria-describedby')).toBe('ingredients-hint');
      expect(text(submitButton(el))).toBe('Lagre oppskrift');
      const cancel = el.querySelector('.form-actions a');
      expect([text(cancel), cancel?.getAttribute('href')]).toEqual(['Avbryt', '/']);
      expect(el.querySelector('.alert')).toBeNull();
      expect(el.querySelector('[aria-invalid]')).toBeNull();
    });
  });

  describe('S-NEW-ERR', () => {
    it('shows both API errors, focuses the summary and keeps nothing it was not given', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      reject(submit(el, 'POST', '/api/recipes'), {
        title: TITLE_ERROR,
        ingredients: INGREDIENTS_ERROR,
      });
      await harness.fixture.whenStable();

      expect(title()).toBe('Feil — Ny oppskrift');
      const summary = el.querySelector<HTMLElement>('.alert');
      expect(summary?.getAttribute('role')).toBe('alert');
      expect(document.activeElement).toBe(summary);
      expect(text(summary?.querySelector('.alert-title'))).toBe('Oppskriften ble ikke lagret');
      expect(
        [...(summary?.querySelectorAll('a') ?? [])].map((a) => [text(a), a.getAttribute('href')]),
      ).toEqual([
        [TITLE_ERROR, '#title'],
        [INGREDIENTS_ERROR, '#ingredients'],
      ]);

      expect(field(el, 'title').getAttribute('aria-invalid')).toBe('true');
      expect(field(el, 'title').getAttribute('aria-describedby')).toBe('title-error');
      expect(text(el.querySelector('#title-error'))).toBe(TITLE_ERROR);
      expect(field(el, 'ingredients').getAttribute('aria-describedby')).toBe(
        'ingredients-hint ingredients-error',
      );
      expect(text(el.querySelector('#ingredients-error'))).toBe(INGREDIENTS_ERROR);
      expect(field(el, 'instructions').hasAttribute('aria-invalid')).toBe(false);
      expect(el.querySelectorAll('.field-invalid')).toHaveLength(2);
    });

    it('sends the values as typed and keeps them, untrimmed, on an error', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      fill(el, 'title', '   ');
      fill(el, 'ingredients', '600 g kjøttdeig');
      const request = submit(el, 'POST', '/api/recipes');
      expect(request.request.body).toEqual({
        title: '   ',
        ingredients: '600 g kjøttdeig',
        instructions: '',
        tags: [],
      });
      reject(request, { title: TITLE_ERROR });
      await harness.fixture.whenStable();

      expect(field(el, 'title').value).toBe('   ');
      expect(field(el, 'ingredients').value).toBe('600 g kjøttdeig');
      expect([...el.querySelectorAll('.alert li')].map(text)).toEqual([TITLE_ERROR]);
      expect(field(el, 'ingredients').hasAttribute('aria-invalid')).toBe(false);
    });

    it('jumps from the summary to the field', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      reject(submit(el, 'POST', '/api/recipes'), { ingredients: INGREDIENTS_ERROR });
      await harness.fixture.whenStable();
      el.querySelector<HTMLAnchorElement>('.alert a')?.click();
      expect(document.activeElement).toBe(field(el, 'ingredients'));
      expect(TestBed.inject(Router).url).toBe('/recipes/new');
    });

    it('shows S-500 when the API fails for another reason', async () => {
      const harness = await openHarness('/recipes/new');
      submit(page(harness), 'POST', '/api/recipes').flush(null, {
        status: 500,
        statusText: 'Error',
      });
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('h1'))).toBe('Noe gikk galt');
      expect(title()).toBe('Noe gikk galt — food.st44.no');
    });
  });

  describe('a successful create', () => {
    it('guards against a double submit while saving (§3.5)', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      const request = submit(el, 'POST', '/api/recipes');
      await harness.fixture.whenStable();

      const button = submitButton(el);
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(text(button)).toBe('Lagrer…');
      button.closest('form')?.requestSubmit();
      TestBed.tick();
      TestBed.inject(HttpTestingController).expectNone({ method: 'POST' });

      reject(request, { title: TITLE_ERROR });
      await harness.fixture.whenStable();
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute('aria-busy')).toBe(false);
      expect(text(button)).toBe('Lagre oppskrift');
    });

    it('goes to the new recipe with "Oppskriften ble lagret." (§3.3)', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      fill(el, 'title', 'Lapskaus');
      fill(el, 'ingredients', '500 g storfekjøtt');
      const created: Recipe = {
        id: 10,
        title: 'Lapskaus',
        ingredients: '500 g storfekjøtt',
        instructions: '',
        created_at: '2026-10-04T10:00:00Z',
        photo_url: null,
        tags: [],
      };
      const navigated = navigation();
      submit(el, 'POST', '/api/recipes').flush(created, { status: 201, statusText: 'Created' });
      expect((await navigated).url).toBe('/recipes/10?flash=created');

      // The collection is asked for again, so the count and the front page include it.
      answer({ recipe: created });
      await harness.fixture.whenStable();
      const flash = page(harness).querySelector('.flash');
      expect(text(flash)).toBe('Oppskriften ble lagret.');
      expect(flash?.getAttribute('role')).toBe('status');
    });
  });
});
