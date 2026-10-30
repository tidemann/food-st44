import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Recipe } from '../api/types';
import { open, SEED, seed, setUp, text } from '../../testing/app';
import { field, fill, reject, submit } from '../../testing/form';
import { cleanDescription, descriptionText, markTerm } from './description';

const REL = 'rel="noopener nofollow"';
const LONG =
  '<p>Dette er <strong>søndagsmiddagen</strong>.</p><ul><li>Salt farsen først.</li></ul>' +
  '<p>Se også <a href="https://food.st44.no/recipes/5">Lapskaus</a>.</p>';

function withDescription(recipe: Recipe, description: string, plain: string): Recipe {
  return { ...recipe, description, description_text: plain };
}

describe('the description (ST-1937)', () => {
  describe('cleaning, as the server does', () => {
    it('keeps the allowed tags and drops everything else', () => {
      expect(cleanDescription(LONG)).toBe(
        '<p>Dette er <strong>søndagsmiddagen</strong>.</p><ul><li>Salt farsen først.</li></ul>' +
          `<p>Se også <a href="https://food.st44.no/recipes/5" ${REL}>Lapskaus</a>.</p>`,
      );
      expect(cleanDescription('Hei<script>alert(1)</script><style>p{}</style>')).toBe('Hei');
      expect(cleanDescription('<h2>Tittel</h2><img src=x onerror=alert(1)>tekst')).toBe(
        'Titteltekst',
      );
      expect(cleanDescription('<p class="x" onclick="y()"><b title="t">fet</b></p>')).toBe(
        '<p><b>fet</b></p>',
      );
      expect(cleanDescription('a < b & c')).toBe('a &lt; b &amp; c');
      expect(cleanDescription('<p> </p><br>')).toBe('');
    });

    it('keeps only http and https link addresses', () => {
      for (const bad of ['javascript:alert(1)', '/recipes/1', 'data:text/html,x']) {
        expect(cleanDescription(`<a href="${bad}">x</a>`)).toBe(`<a ${REL}>x</a>`);
      }
      expect(cleanDescription('<a href="http://x.no/?a=1&b=2">x</a>')).toBe(
        `<a href="http://x.no/?a=1&amp;b=2" ${REL}>x</a>`,
      );
    });

    it('counts the text, not the tags, with words kept apart', () => {
      expect(descriptionText('<p>Første.</p><p>Andre &amp; <b>tredje</b>.</p>')).toBe(
        'Første. Andre & tredje.',
      );
      expect(descriptionText('<ul><li>Salt</li><li>Pepper</li></ul>Hei<br>du')).toBe(
        'Salt Pepper Hei du',
      );
      expect(descriptionText('<p><strong>' + 'a'.repeat(500) + '</strong></p>')).toHaveLength(500);
    });

    it('marks every match of the search term, ignoring case', () => {
      expect(markTerm('En hvit Saus, og mer saus.', 'saus')).toEqual([
        { text: 'En hvit ', hit: false },
        { text: 'Saus', hit: true },
        { text: ', og mer ', hit: false },
        { text: 'saus', hit: true },
        { text: '.', hit: false },
      ]);
      expect(markTerm('Ingen treff', 'saus')).toEqual([{ text: 'Ingen treff', hit: false }]);
      expect(markTerm('', 'saus')).toEqual([]);
    });
  });

  describe('on the pages', () => {
    beforeEach(() => {
      setUp();
    });
    afterEach(() => {
      TestBed.inject(HttpTestingController).verify();
    });

    it('the recipe page shows it under the title, with its formatting', async () => {
      const recipe = withDescription(seed(9), cleanDescription(LONG), descriptionText(LONG));
      const el = await open('/recipes/9', { recipe });
      const lede = el.querySelector('.rt .recipe-description');
      expect(lede?.querySelector('strong')?.textContent).toBe('søndagsmiddagen');
      expect(lede?.querySelectorAll('li')).toHaveLength(1);
      const link = lede?.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://food.st44.no/recipes/5');
      expect(link?.getAttribute('rel')).toBe('noopener nofollow');
    });

    it('a recipe without one shows no empty paragraph', async () => {
      const el = await open('/recipes/9', { recipe: seed(9) });
      expect(el.querySelector('.recipe-description')).toBeNull();
    });

    it('the front page leads with it, the count under it, and lists show it as text', async () => {
      const all = SEED.map((recipe, i) =>
        i === 2
          ? recipe
          : withDescription(recipe, `<b>Om</b> ${recipe.title}.`, `Om ${recipe.title}.`),
      );
      const el = await open('/', { all });
      expect(text(el.querySelector('.lead-blurb'))).toBe(`Om ${SEED[0]?.title ?? ''}.`);
      expect(el.querySelector('.lead-dek')?.classList).toContain('lead-dek-small');
      const side = [...el.querySelectorAll('.lead-side .sideitem')];
      expect(text(side[0]?.querySelector('.blurb'))).toBe(`Om ${SEED[1]?.title ?? ''}.`);
      // The third recipe has none: no empty line.
      expect(side[1]?.querySelector('.blurb')).toBeNull();
      expect(el.querySelector('.blurb b')).toBeNull();
      expect(el.querySelector('.card .blurb-3')).not.toBeNull();
    });

    it('the front page without a description keeps its one italic line', async () => {
      const el = await open('/');
      expect(el.querySelector('.lead-blurb')).toBeNull();
      expect(el.querySelector('.lead-dek')?.classList).not.toContain('lead-dek-small');
    });

    it('a search hit marks the word in the description', async () => {
      const hit = withDescription(seed(9), 'Med en hvit <b>saus</b>.', 'Med en hvit saus.');
      const el = await open('/?q=saus', { search: [hit] });
      const blurb = el.querySelector('.hits .blurb');
      expect(text(blurb)).toBe('Med en hvit saus.');
      expect([...(blurb?.querySelectorAll('mark') ?? [])].map(text)).toEqual(['saus']);
    });

    it('the form counts the text, previews it cleaned, and shows the server’s error', async () => {
      const el = await open('/recipes/new');
      expect(text(el.querySelector('#description-count'))).toBe('0 av 500 tegn');
      expect(el.querySelector('.preview')).toBeNull();
      expect([...el.querySelectorAll('.allowed code')].map(text)).toContain('<strong>');

      fill(el, 'description', '<p>En <strong>god</strong> rett.<script>x()</script></p>');
      TestBed.tick();
      expect(text(el.querySelector('#description-count'))).toBe('12 av 500 tegn');
      const preview = el.querySelector('.preview');
      expect(preview?.innerHTML).toBe('<p>En <strong>god</strong> rett.</p>');

      fill(el, 'description', 'a'.repeat(571));
      TestBed.tick();
      const count = el.querySelector('#description-count');
      expect(text(count)).toBe('571 av 500 tegn');
      expect(count?.classList).toContain('over');

      fill(el, 'title', 'Kjøttkaker');
      fill(el, 'ingredients', 'kjøttdeig');
      const request = submit(el, 'POST', '/api/recipes');
      expect((request.request.body as { description: string }).description).toBe('a'.repeat(571));
      const error = 'Beskrivelsen kan ikke være lengre enn 500 tegn. Kort den ned med 71 tegn.';
      reject(request, { description: error });
      TestBed.tick();
      expect(text(el.querySelector('#error-summary li'))).toBe(error);
      expect(text(el.querySelector('#description-error'))).toBe(error);
      expect(field(el, 'description').getAttribute('aria-invalid')).toBe('true');
    });

    it('editing a recipe starts from its description', async () => {
      const recipe = withDescription(seed(9), '<p>Gammel.</p>', 'Gammel.');
      const el = await open('/recipes/9/edit', { recipe });
      expect(field(el, 'description').value).toBe('<p>Gammel.</p>');
    });
  });
});
