import {
  formatLong,
  formatMastheadDate,
  formatShort,
  ingredientLines,
  photoFor,
  slugify,
  splitIngredient,
  stepsFor,
} from './format';

describe('format (v1 view-model rules, inventory §3.6)', () => {
  it('splits a leading amount off an ingredient line', () => {
    expect(splitIngredient('600 g kjøttdeig av storfe')).toEqual({
      amount: '600 g',
      name: 'kjøttdeig av storfe',
    });
    expect(splitIngredient('1 liten løk, finrevet')).toEqual({
      amount: '1',
      name: 'liten løk, finrevet',
    });
    expect(splitIngredient('1 ½ dl makaroni')).toEqual({ amount: '1 ½ dl', name: 'makaroni' });
    expect(splitIngredient('2-3 ss smør')).toEqual({ amount: '2-3 ss', name: 'smør' });
    expect(splitIngredient('salt og pepper')).toEqual({ amount: '', name: 'salt og pepper' });
  });

  it('drops blank ingredient lines', () => {
    expect(ingredientLines('\n1 l rømme\n  \n2 dl mel ')).toEqual(['1 l rømme', '2 dl mel']);
  });

  it('makes paragraphs into steps, or lines when there is one paragraph', () => {
    expect(stepsFor('Kok.\n\nRør\ninn mel.')).toEqual(['Kok.', 'Rør inn mel.']);
    expect(stepsFor('1. Riv.\n2) Bland.\n(3) Kok.')).toEqual(['Riv.', 'Bland.', 'Kok.']);
    expect(stepsFor('  ')).toEqual([]);
  });

  it('formats dates in Oslo time, nb-NO', () => {
    expect(formatShort('2026-10-02T10:00:00Z')).toBe('2. okt');
    expect(formatLong('2026-10-02T23:30:00Z')).toBe('3. oktober 2026');
    expect(formatMastheadDate(new Date('2026-10-04T10:00:00Z'))).toBe('Søndag 4. oktober 2026');
  });

  it('finds a photo by slugified title', () => {
    expect(slugify('Kjøttkaker i brun saus')).toBe('kjottkaker-i-brun-saus');
    expect(slugify('Smørbrød med reker!')).toBe('smorbrod-med-reker');
    expect(photoFor('Fårikål')?.src).toBe('/img/recipes/farikal.jpg');
    expect(photoFor('Pannekaker')).toBeNull();
  });
});
