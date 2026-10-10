import { MAX_TAG, normaliseTag, sortTags, tagLabel, tagParam } from './tags';

describe('tags', () => {
  it('normalises as the API stores: trimmed, one space, lower case', () => {
    expect(normaliseTag('  Middag ')).toBe('middag');
    expect(normaliseTag('Rask   HVERDAGS\tmat')).toBe('rask hverdags mat');
    expect(normaliseTag('ÆBLESKIVER')).toBe('æbleskiver');
    expect(normaliseTag('   ')).toBe('');
  });

  it(`cuts a tag at ${String(MAX_TAG)} characters, never ending on a space`, () => {
    expect(normaliseTag('a'.repeat(30))).toHaveLength(MAX_TAG);
    expect(normaliseTag(`${'a'.repeat(23)} b`)).toBe('a'.repeat(23));
  });

  it('sorts in Norwegian order: Æ, Ø, Å after Z', () => {
    expect(sortTags(['åpent', 'øl', 'zucchini', 'æble', 'middag'])).toEqual([
      'middag',
      'zucchini',
      'æble',
      'øl',
      'åpent',
    ]);
  });

  it('shows a tag with a capital, as in the pictures', () => {
    expect(tagLabel('middag')).toBe('Middag');
    expect(tagLabel('ørret')).toBe('Ørret');
  });

  it('reads ?tag= as stored, or blank', () => {
    expect(tagParam(' Middag')).toBe('middag');
    expect(tagParam(undefined)).toBe('');
  });
});
