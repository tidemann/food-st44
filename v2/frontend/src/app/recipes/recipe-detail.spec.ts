import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Recipe } from '../api/types';
import { open, seed, setUp, text, title } from '../../testing/app';

function openRecipe(url: string, recipe: Recipe | number): Promise<HTMLElement> {
  return open(url, { recipe });
}

const kjottkaker = seed(9);
const pannekaker = seed(7);

describe('RecipeDetail', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('S-DETAIL', () => {
    it('shows the title, the meta list and the crumb', async () => {
      const el = await openRecipe('/recipes/9', kjottkaker);
      expect(text(el.querySelector('h1'))).toBe('Kjøttkaker i brun saus');
      expect(title()).toBe('Kjøttkaker i brun saus — food.st44.no');
      expect(
        [...el.querySelectorAll('.rmeta dl > div')].map(
          (d) => `${text(d.querySelector('dt'))} ${text(d.querySelector('dd'))}`,
        ),
      ).toEqual([
        'Ingredienser 4',
        'Fremgangsmåte 3 steg',
        'Lagt inn 2. oktober 2026',
        'Emneord Kjøtt · Middag',
      ]);
      expect(text(el.querySelector('.crumb'))).toBe('Oppskrifter / Kjøttkaker i brun saus');
      expect(el.querySelector('.crumb a')?.getAttribute('href')).toBe('/');
      expect(el.querySelector('img')).toBeNull();
    });

    it('splits amounts into their own column, plain lines span the row', async () => {
      const el = await openRecipe('/recipes/9', kjottkaker);
      const rows = [...el.querySelectorAll('.ing li')];
      expect(rows.map((li) => text(li.querySelector('b')))).toEqual(['600 g', '1', '1', '']);
      expect(text(rows[0]?.querySelector('span'))).toBe('kjøttdeig av storfe');
      expect(rows[3]?.classList).toContain('li-plain');
      expect(rows[0]?.classList).not.toContain('li-plain');
    });

    it('numbers the steps', async () => {
      const el = await openRecipe('/recipes/9', kjottkaker);
      const steps = [...el.querySelectorAll('.step')];
      expect(steps.map((s) => text(s.querySelector('.n')))).toEqual(['1', '2', '3']);
      expect(text(steps[1]?.querySelector('p'))).toBe('Form kaker og brun dem i smør.');
    });

    it('asks for the steps when there are none, without ?q=', async () => {
      const el = await openRecipe('/recipes/7?q=kake', pannekaker);
      expect(el.querySelector('.step')).toBeNull();
      expect(text(el.querySelector('.steps-none'))).toBe(
        'Ingen fremgangsmåte er skrevet inn ennå. Skriv den inn.',
      );
      expect(el.querySelector('.steps-none a')?.getAttribute('href')).toBe('/recipes/7/edit');
    });

    it('carries the search on to the crumb, Rediger and Slett', async () => {
      const el = await openRecipe('/recipes/9?q=saus', kjottkaker);
      expect(el.querySelector('.crumb a')?.getAttribute('href')).toBe('/?q=saus');
      expect(
        [...el.querySelectorAll('.acts a')].map((a) => [text(a), a.getAttribute('href')]),
      ).toEqual([
        ['Rediger', '/recipes/9/edit?q=saus'],
        ['Slett', '/recipes/9/delete?q=saus'],
      ]);
    });

    it('parses the id leniently, like v1: /recipes/9abc is recipe 9', async () => {
      const el = await openRecipe('/recipes/9abc', kjottkaker);
      expect(text(el.querySelector('h1'))).toBe('Kjøttkaker i brun saus');
    });
  });

  describe('S-404R', () => {
    it('shows "Fant ikke oppskriften" for an unknown id', async () => {
      const el = await openRecipe('/recipes/999', 404);
      expect(text(el.querySelector('h1'))).toBe('Fant ikke oppskriften');
      expect(text(el.querySelector('.notice p'))).toBe(
        'Den kan ha blitt slettet, eller lenken er feil.',
      );
      expect(el.querySelector('.notice .btn')?.getAttribute('href')).toBe('/');
      expect(title()).toBe('Fant ikke oppskriften — food.st44.no');
    });

    it.each(['0', '-1', 'abc'])('does not ask the API about /recipes/%s', async (id) => {
      const el = await open(`/recipes/${id}`);
      TestBed.inject(HttpTestingController).expectNone((r) => r.url.startsWith('/api/recipes/'));
      expect(text(el.querySelector('h1'))).toBe('Fant ikke oppskriften');
    });
  });

  describe('S-500', () => {
    it('shows "Noe gikk galt" when the API fails', async () => {
      const el = await openRecipe('/recipes/9', 500);
      expect(text(el.querySelector('h1'))).toBe('Noe gikk galt');
      expect(
        [...el.querySelectorAll('.notice .btn')].map((a) => [text(a), a.getAttribute('href')]),
      ).toEqual([
        ['Prøv på nytt', '/recipes/9'],
        ['Til alle oppskrifter', '/'],
      ]);
      expect(title()).toBe('Noe gikk galt — food.st44.no');
    });
  });

  describe('ST-784: emneord', () => {
    it('links each tag to the list filtered on it', async () => {
      const el = await openRecipe('/recipes/9', kjottkaker);
      const links = [...el.querySelectorAll('.rmeta .tags a')];
      expect(links.map(text)).toEqual(['Kjøtt', 'Middag']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/?tag=kj%C3%B8tt',
        '/?tag=middag',
      ]);
    });

    it('has no Emneord row for a recipe without tags', async () => {
      const el = await openRecipe('/recipes/7', pannekaker);
      expect(el.querySelector('.rmeta .tags')).toBeNull();
    });

    it('reached from a filter, the crumb goes back to it and the actions carry it', async () => {
      const el = await openRecipe('/recipes/9?q=saus&tag=middag', kjottkaker);
      expect(text(el.querySelector('.crumb'))).toBe(
        'Oppskrifter / Middag / Kjøttkaker i brun saus',
      );
      const crumbs = [...el.querySelectorAll('.crumb a')].map((a) => a.getAttribute('href'));
      expect(crumbs).toEqual(['/?q=saus', '/?q=saus&tag=middag']);
      expect(el.querySelector('.acts a')?.getAttribute('href')).toBe(
        '/recipes/9/edit?q=saus&tag=middag',
      );
    });
  });
});
