import type { Recipe } from '../api/types';
import {
  formatLong,
  formatMastheadDate,
  formatShort,
  ingredientsFor,
  pluralise,
  splitIngredient,
  stepsFor,
  toCard,
  toIndex,
} from './format';

describe('format', () => {
  it('splits a leading amount off an ingredient line', () => {
    expect(splitIngredient('600 g kjøttdeig av storfe')).toEqual({
      amount: '600 g',
      name: 'kjøttdeig av storfe',
    });
    expect(splitIngredient('1 liten løk, finrevet')).toEqual({
      amount: '1',
      name: 'liten løk, finrevet',
    });
    expect(splitIngredient('1,5 dl melk')).toEqual({ amount: '1,5 dl', name: 'melk' });
    expect(splitIngredient('½ ts pepper')).toEqual({ amount: '½ ts', name: 'pepper' });
    expect(splitIngredient('1 ½ dl makaroni')).toEqual({ amount: '1 ½ dl', name: 'makaroni' });
    expect(splitIngredient('2–3 SS. smør')).toEqual({ amount: '2–3 SS', name: 'smør' });
    expect(splitIngredient('salt og pepper')).toEqual({ amount: '', name: 'salt og pepper' });
  });

  it('drops blank ingredient lines', () => {
    expect(ingredientsFor('\n1 l seterrømme\n  \n1 ts salt ')).toEqual([
      { amount: '1 l', name: 'seterrømme' },
      { amount: '1 ts', name: 'salt' },
    ]);
  });

  it('reads paragraphs as steps, or lines when there is one paragraph', () => {
    expect(stepsFor('Kok rømmen.\n\nDryss i\nmelet.')).toEqual(['Kok rømmen.', 'Dryss i melet.']);
    expect(stepsFor('1. Riv potetene.\n2) Bland.\n(3) Form baller.\n4: Kok.')).toEqual([
      'Riv potetene.',
      'Bland.',
      'Form baller.',
      'Kok.',
    ]);
    expect(stepsFor('  ')).toEqual([]);
  });

  it('shows dates in Oslo time, nb-NO', () => {
    // 23:30 UTC on 1 October is already 2 October in Oslo.
    expect(formatShort('2026-10-01T23:30:00Z')).toBe('2. okt');
    expect(formatLong('2026-10-01T23:30:00Z')).toBe('2. oktober 2026');
    expect(formatMastheadDate(new Date('2026-10-04T12:00:00Z'))).toBe('Søndag 4. oktober 2026');
  });

  it('pluralises', () => {
    expect(pluralise(1, 'ingrediens', 'ingredienser')).toBe('1 ingrediens');
    expect(pluralise(9, 'ingrediens', 'ingredienser')).toBe('9 ingredienser');
  });

  it('builds a card and sorts the register with Æ Ø Å last', () => {
    const recipe: Recipe = {
      id: 9,
      title: 'Kjøttkaker',
      ingredients: '1 egg\n2 dl melk',
      instructions: '',
      created_at: '2026-10-02T10:00:00Z',
      photo_url: null,
    };
    const card = toCard(recipe);
    expect(card.meta).toBe('2 ingredienser · 2. okt');
    expect(card.added).toBe('2. oktober 2026');

    const titles = ['Ål', 'Øl', 'Zucchini', 'Ærter', 'Bacon'].map((title, id) =>
      toCard({ ...recipe, id, title }),
    );
    expect(toIndex(titles).map((c) => c.title)).toEqual(['Bacon', 'Zucchini', 'Ærter', 'Øl', 'Ål']);
  });
});
