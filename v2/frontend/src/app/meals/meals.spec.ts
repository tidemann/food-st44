import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Meal } from '../api/types';
import {
  answer,
  open,
  openHarness,
  OUTSIDER,
  page,
  READER,
  setUp,
  signIn,
  text,
  title,
} from '../../testing/app';
import { field, fill, navigation, submit, submitButton } from '../../testing/form';
import { allMealsLabel, itemsFor, itemsLabel, splitItem } from './meal';

// Meals (ST-1968, ST-1970 pictures): a dinner without a recipe, a name and what to buy.

const TORO: Meal = {
  id: 3,
  title: 'Toro Tandoori chicken',
  items:
    '2 pk naan\n1 beger crème fraîche\nsolsikkeolje\n1 pk papadums\n600 g kylling\n' +
    'mango chutney\n1 beger raita',
  item_count: 7,
  note: 'Toro-posen tar 25 minutter.',
  created_at: '2026-10-28T10:00:00Z',
};
const BIG_ONE: Meal = {
  id: 4,
  title: 'Big One frozen pizza',
  items: '2 stk Big One pepperoni\n1 pose ruccola',
  item_count: 2,
  note: '',
  created_at: '2026-10-30T10:00:00Z',
};

/** A register row: the title and the count, drawn apart by the leader. */
function row(el: Element): [string, string] {
  return [text(el.querySelector('.t')), text(el.querySelector('.m'))];
}

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

describe('meal words', () => {
  it('puts the amount apart from the name, and leaves a plain item whole', () => {
    expect(splitItem('2 pk naan')).toEqual({ name: 'naan', amount: '2 pk' });
    expect(splitItem('1 beger crème fraîche')).toEqual({
      name: 'crème fraîche',
      amount: '1 beger',
    });
    expect(splitItem('600 g kylling')).toEqual({ name: 'kylling', amount: '600 g' });
    expect(splitItem('mango chutney')).toEqual({ name: 'mango chutney', amount: '' });
    expect(itemsFor(' naan \n\n raita ')).toEqual([
      { name: 'naan', amount: '' },
      { name: 'raita', amount: '' },
    ]);
  });

  it('counts in Norwegian', () => {
    expect([itemsLabel(1), itemsLabel(7)]).toEqual(['1 vare', '7 varer']);
    expect([allMealsLabel(1), allMealsLabel(6)]).toEqual(['Det ene måltidet', 'Alle 6 måltidene']);
  });
});

describe('Måltider (ST-1968)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  describe('/maltider', () => {
    it('lists every meal by title, with its items, and "Nytt måltid" for an editor', async () => {
      const el = await open('/maltider', { meals: [TORO, BIG_ONE] });
      expect(title()).toBe('Måltider — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Måltider');
      expect(text(el.querySelector('.mal-when'))).toBe('2 måltider · middager uten oppskrift');
      const rows = [...el.querySelectorAll('.maltider li a')];
      expect(rows.map(row)).toEqual([
        ['Big One frozen pizza', '2 varer'],
        ['Toro Tandoori chicken', '7 varer'],
      ]);
      expect(rows[1]?.getAttribute('href')).toBe('/maltider/3');
      expect(el.querySelector('.acts a')?.getAttribute('href')).toBe('/maltider/ny');
    });

    it('has no "Nytt måltid" for a reader', async () => {
      const el = await open('/maltider', { me: READER, meals: [TORO] });
      expect(el.querySelectorAll('.maltider li')).toHaveLength(1);
      expect(el.querySelector('.acts')).toBeNull();
    });

    it('says so when there are none, with a way in for an editor only', async () => {
      const editor = await open('/maltider');
      expect(text(editor.querySelector('h1'))).toBe('Ingen måltider ennå');
      expect(text(editor.querySelector('.notice-actions a'))).toBe('Legg til det første måltidet');
    });

    it('says so to a reader when there are none', async () => {
      const reader = await open('/maltider', { me: READER });
      expect(text(reader.querySelector('.notice p'))).toBe(
        'Når husstanden legger inn måltider, finner du dem her.',
      );
      expect(reader.querySelector('.notice-actions')).toBeNull();
    });
  });

  describe('/maltider/:id', () => {
    it('marks it «Måltid», gives its facts without portions, and the items', async () => {
      const el = await open('/maltider/3', { meal: TORO });
      expect(title()).toBe('Toro Tandoori chicken — food.st44.no');
      expect(text(el.querySelector('.maltid-kicker'))).toBe('Måltid');
      expect(text(el.querySelector('h1'))).toBe('Toro Tandoori chicken');
      expect(text(el.querySelector('.crumb'))).toBe('Måltider / Toro Tandoori chicken');
      expect([...el.querySelectorAll('.rmeta dt')].map((dt) => text(dt))).toEqual([
        'Varer',
        'Lagt inn',
      ]);
      const items = [...el.querySelectorAll('.varer li')];
      expect(items).toHaveLength(7);
      expect(text(items[0]?.querySelector('.v'))).toBe('naan');
      expect(text(items[0]?.querySelector('.m'))).toBe('2 pk');
      expect(items[0]?.querySelector('.ldr')).not.toBeNull();
      // no amount: no leader, the name alone
      expect(items[2]?.classList).toContain('v-plain');
      expect(items[2]?.querySelector('.ldr')).toBeNull();
      expect(text(el.querySelector('.maltid-note'))).toBe('Toro-posen tar 25 minutter.');
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('.acts a')?.getAttribute('href')).toBe('/maltider/3/rediger');
    });

    it('closes on the items when there is no note', async () => {
      const el = await open('/maltider/4', { meal: BIG_ONE });
      expect(el.querySelector('.maltid-note')).toBeNull();
      expect(el.querySelectorAll('.varer li')).toHaveLength(2);
    });

    it('gives a reader no "Rediger", "Slett" or "Legg til i ukeplan"', async () => {
      const el = await open('/maltider/3', { me: READER, meal: TORO });
      expect(el.querySelector('.acts')).toBeNull();
      expect(el.querySelector('.plan-add')).toBeNull();
    });

    it('is a meal not-found for an unknown meal', async () => {
      const el = await open('/maltider/999', { meal: 404 });
      expect(text(el.querySelector('h1'))).toBe('Fant ikke måltidet');
      expect(el.querySelector('.notice-actions a')?.getAttribute('href')).toBe('/maltider');
    });
  });

  describe('the form', () => {
    it('adds a meal and opens it', async () => {
      const harness = await openHarness('/maltider/ny');
      const el = page(harness);
      expect(title()).toBe('Nytt måltid — food.st44.no');
      expect(text(submitButton(el))).toBe('Lagre måltid');
      fill(el, 'tittel', 'Big One frozen pizza');
      fill(el, 'varer', '2 stk Big One pepperoni');
      const request = submit(el, 'POST', '/api/meals');
      expect(request.request.body).toEqual({
        title: 'Big One frozen pizza',
        items: '2 stk Big One pepperoni',
        note: '',
      });
      const navigated = navigation();
      request.flush(BIG_ONE, { status: 201, statusText: 'Created' });
      expect((await navigated).url).toBe('/maltider/4?flash=created');
      answer({ meal: BIG_ONE });
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('.flash'))).toBe('Måltidet ble lagret.');
    });

    it('shows the API errors in a summary and under the fields', async () => {
      const harness = await openHarness('/maltider/ny');
      const el = page(harness);
      submit(el, 'POST', '/api/meals').flush(
        { errors: { title: 'Tittelen må fylles ut.', items: 'Skriv inn minst én vare.' } },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await harness.fixture.whenStable();
      expect(title()).toBe('Feil — Nytt måltid');
      expect(text(el.querySelector('.alert-title'))).toBe('Måltidet ble ikke lagret');
      expect([...el.querySelectorAll('.alert li')].map((li) => text(li))).toEqual([
        'Tittelen må fylles ut.',
        'Skriv inn minst én vare.',
      ]);
      expect(field(el, 'varer').getAttribute('aria-invalid')).toBe('true');
      expect(field(el, 'varer').getAttribute('aria-describedby')).toBe('varer-hint varer-error');
      expect(document.activeElement?.id).toBe('error-summary');
    });

    it('edits a meal with what it has', async () => {
      const harness = await openHarness('/maltider/3/rediger', { meal: TORO });
      const el = page(harness);
      expect(text(el.querySelector('h1'))).toBe('Rediger måltid');
      expect(field(el, 'varer').value).toBe(TORO.items);
      expect(field(el, 'notat').value).toBe(TORO.note);
      fill(el, 'notat', '');
      const request = submit(el, 'PUT', '/api/meals/3');
      expect(request.request.body).toEqual({ title: TORO.title, items: TORO.items, note: '' });
      const navigated = navigation();
      request.flush({ ...TORO, note: '' });
      expect((await navigated).url).toBe('/maltider/3?flash=updated');
      answer({ meal: { ...TORO, note: '' } });
      await harness.fixture.whenStable();
    });

    for (const [who, me] of [
      ['nobody signed in', { ...READER, signed_in: false }],
      ['an account not on the list', OUTSIDER],
    ] as const) {
      it(`gives ${who} the no-access page`, async () => {
        const el = await open('/maltider/ny', { me });
        expect(el.querySelector('form.recipe-form')).toBeNull();
      });
    }
  });

  describe('/maltider/:id/slett', () => {
    it('says which days keep its name, then deletes it', async () => {
      // Not openHarness: its whenStable() would wait for the days, which only this test answers.
      const harness = await RouterTestingHarness.create();
      signIn();
      await harness.navigateByUrl('/maltider/3/slett');
      answer({ meal: TORO });
      // the days are asked for once the meal has come
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();
      http().expectOne('/api/meals/3/days').flush(['2026-10-29']);
      await harness.fixture.whenStable();
      const el = page(harness);
      expect(title()).toBe('Slett «Toro Tandoori chicken»? — food.st44.no');
      expect([...el.querySelectorAll('.notice p')].map((p) => text(p))).toEqual([
        'Måltidet blir borte for godt. Dette kan ikke angres.',
        'Det står på torsdag 29. oktober i ukeplanen. Navnet blir stående på den dagen, men ' +
          'lenken til måltidet forsvinner.',
      ]);
      expect(text(submitButton(el))).toBe('Slett måltidet');

      const request = submit(el, 'DELETE', '/api/meals/3');
      const navigated = navigation();
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect((await navigated).url).toBe('/maltider?flash=deleted');
      answer({});
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('.flash'))).toBe('Måltidet ble slettet.');
    });
  });

  describe('the front page', () => {
    it('has a band of the newest meals, apart from the recipes', async () => {
      const el = await open('/', { meals: [TORO, BIG_ONE] });
      const band = el.querySelector('.mal-band');
      expect(text(band?.querySelector('.band-head'))).toBe('Måltider');
      expect([...(band?.querySelectorAll('li') ?? [])].map(row)).toEqual([
        ['Big One frozen pizza', '2 varer'],
        ['Toro Tandoori chicken', '7 varer'],
      ]);
      expect(band?.querySelector('.mal-band-all')).toBeNull();
    });

    it('has no band without meals', async () => {
      const el = await open('/');
      expect(el.querySelector('.mal-band')).toBeNull();
    });
  });
});
