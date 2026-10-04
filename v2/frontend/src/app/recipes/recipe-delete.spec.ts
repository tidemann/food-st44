import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { answer, open, openHarness, page, seed, SEED, setUp, text, title } from '../../testing/app';
import { navigation, submit, submitButton } from '../../testing/form';

const kjottkaker = seed(9);

describe('RecipeDelete', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('S-DELETE', () => {
    it('asks before deleting', async () => {
      const el = await open('/recipes/9/delete', { recipe: kjottkaker });
      expect(title()).toBe('Slett «Kjøttkaker i brun saus»? — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Slett «Kjøttkaker i brun saus»?');
      expect(text(el.querySelector('.notice p'))).toBe(
        'Oppskriften blir borte for godt. Dette kan ikke angres.',
      );
      const cancel = el.querySelector('.notice-actions a');
      expect([text(cancel), cancel?.getAttribute('href')]).toEqual(['Avbryt', '/recipes/9']);
      const button = submitButton(el);
      expect(text(button)).toBe('Slett oppskriften');
      expect(button.classList).toContain('btn-danger');
    });

    it('carries the search on "Avbryt"', async () => {
      const el = await open('/recipes/9/delete?q=saus', { recipe: kjottkaker });
      expect(el.querySelector('.notice-actions a')?.getAttribute('href')).toBe('/recipes/9?q=saus');
    });

    it('shows S-404R for an unknown recipe', async () => {
      const el = await open('/recipes/999/delete', { recipe: 404 });
      expect(text(el.querySelector('h1'))).toBe('Fant ikke oppskriften');
    });
  });

  describe('a delete', () => {
    it('sends one DELETE, then shows the list with "Oppskriften ble slettet." and no search', async () => {
      const harness = await openHarness('/recipes/9/delete?q=saus', { recipe: kjottkaker });
      const el = page(harness);
      const request = submit(el, 'DELETE', '/api/recipes/9');
      await harness.fixture.whenStable();

      const button = submitButton(el);
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      button.closest('form')?.requestSubmit();
      TestBed.tick();
      TestBed.inject(HttpTestingController).expectNone({ method: 'DELETE' });

      const navigated = navigation();
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect((await navigated).url).toBe('/?flash=deleted');

      // The collection is asked for again, without the deleted recipe.
      answer({ all: SEED.slice(1) });
      await harness.fixture.whenStable();
      const list = page(harness);
      expect(text(list.querySelector('.flash'))).toBe('Oppskriften ble slettet.');
      expect(text(list.querySelector('.lead-plate h2'))).toBe('Fårikål');
    });

    it('shows S-404R when the recipe is already gone', async () => {
      const harness = await openHarness('/recipes/9/delete', { recipe: kjottkaker });
      submit(page(harness), 'DELETE', '/api/recipes/9').flush(
        { detail: 'Not Found' },
        { status: 404, statusText: 'Not Found' },
      );
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('h1'))).toBe('Fant ikke oppskriften');
    });
  });
});
