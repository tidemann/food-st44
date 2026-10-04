import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { open, seed, setUp, text } from '../../testing/app';

const kjottkaker = seed(9);

describe('Flash (§3.4)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it.each([
    ['deleted', 'Oppskriften ble slettet.'],
    ['created', 'Oppskriften ble lagret.'],
    ['updated', 'Endringene ble lagret.'],
  ])('shows ?flash=%s on the front page', async (key, message) => {
    const el = await open(`/?flash=${key}`);
    const flash = el.querySelector('.flash');
    expect(text(flash)).toBe(message);
    expect(flash?.getAttribute('role')).toBe('status');
  });

  it('shows on the empty collection too', async () => {
    const el = await open('/?flash=deleted', { all: [] });
    expect(text(el.querySelector('.flash'))).toBe('Oppskriften ble slettet.');
    expect(text(el.querySelector('h2'))).toBe('Ingen oppskrifter ennå');
  });

  it('shows on the recipe page', async () => {
    const el = await open('/recipes/9?flash=updated&q=saus', { recipe: kjottkaker });
    expect(text(el.querySelector('.flash'))).toBe('Endringene ble lagret.');
  });

  it.each(['nonsens', 'constructor', ''])('says nothing for ?flash=%s', async (key) => {
    const el = await open(`/?flash=${key}`);
    expect(el.querySelector('.flash')).toBeNull();
  });

  it('is not on a page without ?flash=', async () => {
    const el = await open('/recipes/9', { recipe: kjottkaker });
    expect(el.querySelector('.flash')).toBeNull();
  });
});
