import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Recipe } from '../api/types';
import { answer, open, openHarness, page, seed, setUp, text, title } from '../../testing/app';
import { field, fill, navigation, reject, submit, submitButton } from '../../testing/form';

const kjottkaker = seed(9);

describe('RecipeEdit', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('S-EDIT', () => {
    it('shows the form filled in with the stored recipe', async () => {
      const el = await open('/recipes/9/edit', { recipe: kjottkaker });
      expect(title()).toBe('Rediger oppskrift — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Rediger oppskrift');
      expect(field(el, 'title').value).toBe(kjottkaker.title);
      expect(field(el, 'ingredients').value).toBe(kjottkaker.ingredients);
      expect(field(el, 'instructions').value).toBe(kjottkaker.instructions);
      expect(text(submitButton(el))).toBe('Lagre endringer');
      expect(el.querySelector('.form-head a')?.getAttribute('href')).toBe('/recipes/9');
      expect(el.querySelector('.form-actions a')?.getAttribute('href')).toBe('/recipes/9');
    });

    it('carries the search on "Tilbake til oppskriften" and "Avbryt"', async () => {
      const el = await open('/recipes/9/edit?q=saus', { recipe: kjottkaker });
      expect(
        [...el.querySelectorAll('.form-head a, .form-actions a')].map((a) => [
          text(a),
          a.getAttribute('href'),
        ]),
      ).toEqual([
        ['Tilbake til oppskriften', '/recipes/9?q=saus'],
        ['Avbryt', '/recipes/9?q=saus'],
      ]);
    });

    it('shows S-404R for an unknown recipe', async () => {
      const el = await open('/recipes/999/edit', { recipe: 404 });
      expect(text(el.querySelector('h1'))).toBe('Fant ikke oppskriften');
      expect(title()).toBe('Fant ikke oppskriften — food.st44.no');
    });
  });

  describe('S-EDIT-ERR', () => {
    it('shows the API errors and keeps what was typed', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      const el = page(harness);
      fill(el, 'title', '');
      fill(el, 'ingredients', '  ');
      const request = submit(el, 'PUT', '/api/recipes/9');
      expect(request.request.body).toEqual({
        title: '',
        ingredients: '  ',
        instructions: kjottkaker.instructions,
      });
      reject(request, {
        title: 'Tittelen må fylles ut.',
        ingredients: 'Skriv inn minst én ingrediens.',
      });
      await harness.fixture.whenStable();

      expect(title()).toBe('Feil — Rediger oppskrift');
      expect(document.activeElement).toBe(el.querySelector('.alert'));
      expect(text(el.querySelector('#title-error'))).toBe('Tittelen må fylles ut.');
      expect(text(el.querySelector('#ingredients-error'))).toBe('Skriv inn minst én ingrediens.');
      expect(field(el, 'ingredients').value).toBe('  ');
      expect(text(submitButton(el))).toBe('Lagre endringer');
    });

    it('shows S-404R when the recipe was deleted meanwhile', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      submit(page(harness), 'PUT', '/api/recipes/9').flush(
        { detail: 'Not Found' },
        { status: 404, statusText: 'Not Found' },
      );
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('h1'))).toBe('Fant ikke oppskriften');
    });
  });

  describe('a successful edit', () => {
    it('goes back to the recipe with "Endringene ble lagret.", keeping the search', async () => {
      const harness = await openHarness('/recipes/9/edit?q=saus', { recipe: kjottkaker });
      const el = page(harness);
      fill(el, 'title', 'Kjøttkaker i brun saus med tyttebær');
      const saved: Recipe = { ...kjottkaker, title: 'Kjøttkaker i brun saus med tyttebær' };
      const navigated = navigation();
      submit(el, 'PUT', '/api/recipes/9').flush(saved);
      expect((await navigated).url).toBe('/recipes/9?flash=updated&q=saus');

      answer({ recipe: saved });
      await harness.fixture.whenStable();
      const detail = page(harness);
      expect(text(detail.querySelector('.flash'))).toBe('Endringene ble lagret.');
      expect(text(detail.querySelector('h1'))).toBe('Kjøttkaker i brun saus med tyttebær');
      expect(detail.querySelector('.crumb a')?.getAttribute('href')).toBe('/?q=saus');
    });
  });
});
