import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PlanDay, PlanWeek } from '../api/types';
import {
  answer,
  open,
  openHarness,
  OUTSIDER,
  page,
  READER,
  seed,
  setUp,
  signIn,
  text,
  title,
} from '../../testing/app';
import { field, fill, navigation } from '../../testing/form';
import { dayLong, dayShort, weekRange, whenSet } from './plan';

// The week plan (ST-1231): week 43 of 2026, Monday 19 to Sunday 25 October, today Thursday 22.

const WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

function day(date: string, dinner: Partial<PlanDay> = {}): PlanDay {
  const index = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return {
    date,
    weekday: WEEKDAYS[index] ?? '',
    recipe_id: null,
    title: '',
    text: '',
    portions: null,
    servings: null,
    recipe_deleted: false,
    set_by: '',
    set_at: null,
    ...dinner,
  };
}

const KJOTTKAKER: Partial<PlanDay> = {
  recipe_id: 9,
  title: 'Kjøttkaker i brun saus',
  portions: 4,
  servings: 4,
  set_by: 'Maria',
  set_at: '2026-10-21T18:00:00Z',
};
const TACO: Partial<PlanDay> = { text: 'Taco', set_by: 'Stig', set_at: '2026-10-22T08:00:00Z' };

function w43(dinners: Record<string, Partial<PlanDay>> = {}): PlanWeek {
  const dates = ['19', '20', '21', '22', '23', '24', '25'].map((d) => `2026-10-${d}`);
  return {
    week: '2026-W43',
    number: 43,
    start: '2026-10-19',
    end: '2026-10-25',
    previous: '2026-W42',
    next: '2026-W44',
    today: '2026-10-22',
    days: dates.map((date) => day(date, dinners[date])),
    last_change_by: 'Stig',
    last_change_at: '2026-10-22T08:00:00Z',
  };
}

function w44(dinners: Record<string, Partial<PlanDay>> = {}): PlanWeek {
  const dates = ['26', '27', '28', '29', '30', '31'].map((d) => `2026-10-${d}`);
  return {
    week: '2026-W44',
    number: 44,
    start: '2026-10-26',
    end: '2026-11-01',
    previous: '2026-W43',
    next: '2026-W45',
    today: '2026-10-22',
    days: [...dates, '2026-11-01'].map((date) => day(date, dinners[date])),
    last_change_by: '',
    last_change_at: null,
  };
}

const PLANNED = { '2026-10-22': KJOTTKAKER, '2026-10-23': TACO };

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

/** Answers the plan's GET for `url`. */
function answerWeek(url: string, body: PlanWeek | number): void {
  TestBed.tick();
  const request = http().expectOne({ method: 'GET', url });
  if (typeof body === 'number') {
    request.flush({ detail: 'Error' }, { status: body, statusText: 'Error' });
  } else {
    request.flush(body);
  }
}

/** Answers the plan's GET for `url` and lets the page render. */
async function flushWeek(
  harness: RouterTestingHarness,
  url: string,
  body: PlanWeek | number,
): Promise<void> {
  answerWeek(url, body);
  await harness.fixture.whenStable();
}

/** Lets a save's answer reach the page: the awaited request settles after `whenStable()`. */
async function settle(harness: RouterTestingHarness): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await harness.fixture.whenStable();
}

/**
 * Opens a plan page as an editor. Not `openHarness`: its `whenStable()` would wait for the
 * plan's request, which only this test answers.
 */
async function openWeek(
  url: string,
  week: PlanWeek | number,
  apiUrl: string,
): Promise<RouterTestingHarness> {
  const harness = await RouterTestingHarness.create();
  signIn();
  await harness.navigateByUrl(url);
  answer({});
  await flushWeek(harness, apiUrl, week);
  return harness;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll('button')].find((b) => text(b).startsWith(label));
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

describe('plan words', () => {
  it('writes dates in Norwegian, whatever the locale', () => {
    expect(dayShort('2026-10-19')).toBe('Mandag 19. okt');
    expect(dayLong('2026-10-22')).toBe('torsdag 22. oktober');
  });

  it('writes a week across a month and across a year', () => {
    expect(weekRange('2026-10-19', '2026-10-25')).toBe('19.–25. oktober 2026');
    expect(weekRange('2026-10-26', '2026-11-01')).toBe('26. oktober–1. november 2026');
    expect(weekRange('2026-12-28', '2027-01-03')).toBe('28. desember 2026–3. januar 2027');
  });

  it('says when a day was set', () => {
    expect(whenSet('2026-10-22T08:00:00Z', '2026-10-22')).toBe('i dag');
    expect(whenSet('2026-10-21T18:00:00Z', '2026-10-22')).toBe('i går');
    expect(whenSet('2026-10-19T12:00:00Z', '2026-10-22')).toBe('19. oktober');
  });
});

describe('Ukeplan (ST-1231)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  describe('/ukeplan', () => {
    it('shows the week: recipes with portions, a text, empty days, today marked', async () => {
      const harness = await openWeek(
        '/ukeplan?uke=2026-W43',
        w43(PLANNED),
        '/api/plan?week=2026-W43',
      );
      const el = page(harness);
      expect(title()).toBe('Ukeplan — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Ukeplan');
      expect(text(el.querySelector('.plan-when'))).toBe('Uke 43 · 19.–25. oktober 2026');

      const days = [...el.querySelectorAll('.day')];
      expect(days.map((d) => text(d.querySelector('.day-label > span')))).toEqual([
        'Mandag 19. okt',
        'Tirsdag 20. okt',
        'Onsdag 21. okt',
        'Torsdag 22. okt · I dag',
        'Fredag 23. okt',
        'Lørdag 24. okt',
        'Søndag 25. okt',
      ]);
      expect(days[3]?.classList).toContain('day-today');
      expect(text(days[3]?.querySelector('.portions'))).toBe('4 porsjoner');
      expect(days[3]?.querySelector('a.dish')?.getAttribute('href')).toBe('/recipes/9');
      expect(text(days[4]?.querySelector('.free'))).toBe('Taco');
      expect(days[4]?.querySelector('.day-edit')?.getAttribute('href')).toBe('/ukeplan/2026-10-23');
      const add = days[0]?.querySelector('.day-add');
      expect(text(add)).toBe('Legg til middag mandag 19. oktober');
      expect(add?.getAttribute('href')).toBe('/ukeplan/2026-10-19');

      expect(
        [...el.querySelectorAll('.weeknav a')].map((a) => [text(a), a.getAttribute('href')]),
      ).toEqual([
        ['Forrige uke', '/ukeplan?uke=2026-W42'],
        ['Neste uke', '/ukeplan?uke=2026-W44'],
      ]);
      expect(
        [...el.querySelectorAll('.plan-facts dl > div')].map(
          (d) => `${text(d.querySelector('dt'))}: ${text(d.querySelector('dd'))}`,
        ),
      ).toEqual([
        'Uke: 43',
        'Planlagt: 2 av 7 dager',
        'Tomme dager: mandag, tirsdag, onsdag, lørdag, søndag',
        'Sist endret: Stig, i dag',
      ]);
      expect(el.querySelector('.empty-note')).toBeNull();
    });

    it('asks for this week when the address has none', async () => {
      const harness = await openWeek('/ukeplan', w43(), '/api/plan?week=');
      expect(text(page(harness).querySelector('.empty-note h2'))).toBe(
        'Ingen middager i uke 43 ennå',
      );
    });

    it('keeps the title of a deleted recipe, and says so', async () => {
      const gone = { title: 'Lapskaus', recipe_deleted: true, portions: 4 };
      const harness = await openWeek(
        '/ukeplan?uke=2026-W43',
        w43({ '2026-10-20': gone }),
        '/api/plan?week=2026-W43',
      );
      const tuesday = page(harness).querySelectorAll('.day')[1];
      expect(text(tuesday?.querySelector('.day-dish p'))).toBe('Lapskaus');
      expect(tuesday?.querySelector('a.dish')).toBeNull();
      expect(text(tuesday?.querySelector('.gone'))).toBe('· oppskriften er slettet');
    });

    it('is the page-not-found for a week that does not exist', async () => {
      const harness = await openWeek('/ukeplan?uke=2026-W54', 422, '/api/plan?week=2026-W54');
      expect(page(harness).querySelector('app-not-found')).not.toBeNull();
    });

    for (const [who, me, heading] of [
      ['an anonymous visitor', READER, 'Logg inn for å endre'],
      ['a signed-in non-editor', OUTSIDER, 'Ingen tilgang'],
    ] as const) {
      it(`shows ${who} the no-access page and never asks for the plan`, async () => {
        const el = await open('/ukeplan?uke=2026-W43', { me });
        expect(text(el.querySelector('h1'))).toBe(heading);
        expect(el.querySelector('.week')).toBeNull();
        expect(http().match((r) => r.url.startsWith('/api/plan'))).toEqual([]);
      });

      it(`shows ${who} the no-access page for a day`, async () => {
        const el = await open('/ukeplan/2026-10-22', { me });
        expect(text(el.querySelector('h1'))).toBe(heading);
        expect(http().match((r) => r.url.startsWith('/api/plan'))).toEqual([]);
      });
    }
  });

  describe('/ukeplan/:date', () => {
    it('opens an empty day on the search, and adds a recipe with its portions', async () => {
      const harness = await openWeek(
        '/ukeplan/2026-10-19',
        w43(PLANNED),
        '/api/plan?week=2026-10-19',
      );
      let el = page(harness);
      expect(text(el.querySelector('h1'))).toBe('Mandag 19. oktober');
      expect(text(el.querySelector('.plan-when'))).toBe('Uke 43 · ingen middag ennå');
      expect([...el.querySelectorAll('.hits .t')].map((t) => text(t))).toEqual([
        'Fiskegrateng',
        'Fårikål',
        'Kjøttkaker i brun saus',
        'Lapskaus',
        'Pannekaker',
        'Pinnekjøtt',
      ]);

      fill(el, 'plan-sok', 'kjøtt');
      await harness.fixture.whenStable();
      expect(text(el.querySelector('.hits-more'))).toBe('2 treff på «kjøtt»');
      button(el, 'Kjøttkaker i brun saus').click();
      await harness.fixture.whenStable();

      el = page(harness);
      expect(text(el.querySelector('.chosen h2'))).toBe('Kjøttkaker i brun saus');
      expect(text(el.querySelector('.chosen .m'))).toBe(
        '4 ingredienser · 4 porsjoner i oppskriften',
      );
      expect(field(el, 'porsjoner').value).toBe('4');
      fill(el, 'porsjoner', '6');

      const navigated = navigation();
      button(el, 'Legg til middag').click();
      TestBed.tick();
      const put = http().expectOne({ method: 'PUT', url: '/api/plan/2026-10-19' });
      expect(put.request.body).toEqual({ recipe_id: 9, portions: 6 });
      put.flush(day('2026-10-19', { ...KJOTTKAKER, portions: 6 }));
      expect((await navigated).url).toBe('/ukeplan?uke=2026-W43');

      await flushWeek(harness, '/api/plan?week=2026-W43', w43(PLANNED));
      expect(text(page(harness).querySelector('.flash'))).toBe(
        'Kjøttkaker i brun saus er lagt til mandag 19. oktober.',
      );
    });

    it('sets a short text instead', async () => {
      const harness = await openWeek('/ukeplan/2026-10-24', w43(), '/api/plan?week=2026-10-24');
      const el = page(harness);
      fill(el, 'fritekst', '  Rester ');
      const navigated = navigation();
      button(el, 'Legg til teksten').click();
      TestBed.tick();
      const put = http().expectOne({ method: 'PUT', url: '/api/plan/2026-10-24' });
      expect(put.request.body).toEqual({ text: 'Rester' });
      put.flush(day('2026-10-24', { text: 'Rester' }));
      await navigated;
      await flushWeek(harness, '/api/plan?week=2026-W43', w43());
      expect(text(page(harness).querySelector('.flash'))).toBe(
        '«Rester» er satt på lørdag 24. oktober.',
      );
    });

    it('shows a planned day, and swaps it with a taken day', async () => {
      const harness = await openWeek(
        '/ukeplan/2026-10-22',
        w43(PLANNED),
        '/api/plan?week=2026-10-22',
      );
      const el = page(harness);
      expect(text(el.querySelector('h1'))).toBe('Torsdag 22. oktober');
      expect(text(el.querySelector('.plan-when'))).toBe('Uke 43 · I dag · satt av Maria i går');
      expect(text(el.querySelector('.chosen h2'))).toBe('Kjøttkaker i brun saus');
      const moves = [...el.querySelectorAll('.moves')].at(-1);
      expect([...(moves?.querySelectorAll('li') ?? [])].map((li) => text(li))).toEqual([
        'Mandag 19. okt Tom',
        'Tirsdag 20. okt Tom',
        'Onsdag 21. okt Tom',
        'Fredag 23. okt Har Taco',
        'Lørdag 24. okt Tom',
        'Søndag 25. okt Tom',
      ]);

      const navigated = navigation();
      button(el, 'Fredag 23. okt').click();
      TestBed.tick();
      const move = http().expectOne({ method: 'POST', url: '/api/plan/2026-10-22/move' });
      expect(move.request.body).toEqual({ to: '2026-10-23' });
      move.flush({ days: [day('2026-10-22', TACO), day('2026-10-23', KJOTTKAKER)] });
      await navigated;
      await flushWeek(harness, '/api/plan?week=2026-W43', w43());
      expect(text(page(harness).querySelector('.flash'))).toBe(
        'Kjøttkaker i brun saus og Taco byttet plass: Kjøttkaker i brun saus står nå ' +
          'fredag 23. oktober, Taco torsdag 22. oktober.',
      );
    });

    it('removes the dinner', async () => {
      const harness = await openWeek(
        '/ukeplan/2026-10-23',
        w43(PLANNED),
        '/api/plan?week=2026-10-23',
      );
      const navigated = navigation();
      button(page(harness), 'Fjern middagen').click();
      TestBed.tick();
      http().expectOne({ method: 'DELETE', url: '/api/plan/2026-10-23' }).flush(null);
      await navigated;
      await flushWeek(harness, '/api/plan?week=2026-W43', w43());
      expect(text(page(harness).querySelector('.flash'))).toBe(
        'Taco er fjernet fra fredag 23. oktober.',
      );
    });

    it("shows the API's message on the portions field and stays", async () => {
      const harness = await openWeek(
        '/ukeplan/2026-10-22',
        w43(PLANNED),
        '/api/plan?week=2026-10-22',
      );
      const el = page(harness);
      fill(el, 'porsjoner', '0');
      button(el, 'Lagre endringer').click();
      TestBed.tick();
      http()
        .expectOne({ method: 'PUT', url: '/api/plan/2026-10-22' })
        .flush(
          {
            detail: 'Invalid',
            errors: { portions: 'Porsjoner må være et helt tall fra 1 til 99.' },
          },
          { status: 422, statusText: 'Unprocessable' },
        );
      await settle(harness);
      expect(text(el.querySelector('#porsjoner-error'))).toBe(
        'Porsjoner må være et helt tall fra 1 til 99.',
      );
      expect(el.querySelector('#porsjoner')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('is the page-not-found for a date that does not exist', async () => {
      const el = await open('/ukeplan/2026-02-30');
      expect(el.querySelector('app-not-found')).not.toBeNull();
    });
  });

  describe('"Legg til i ukeplan" on the recipe page', () => {
    async function openPicker(): Promise<RouterTestingHarness> {
      const harness = await openHarness('/recipes/9', { recipe: seed(9) });
      button(page(harness), 'Legg til i ukeplan').click();
      answerWeek('/api/plan?week=', w43(PLANNED));
      // the next week is asked for once this one has come
      await new Promise((resolve) => setTimeout(resolve));
      await flushWeek(harness, '/api/plan?week=2026-W44', w44());
      return harness;
    }

    it('lists this week and the next, and adds the recipe to an empty day', async () => {
      const harness = await openPicker();
      const el = page(harness);
      expect([...el.querySelectorAll('.plan-pick .wk')].map((w) => text(w))).toEqual([
        'Denne uken · uke 43',
        'Neste uke · uke 44',
      ]);
      expect(text(el.querySelectorAll('.plan-pick .moves li')[3])).toBe(
        'Torsdag 22. okt · I dag Har Kjøttkaker i brun saus',
      );
      expect(field(el, 'porsjoner').value).toBe('4');

      button(el, 'Mandag 26. okt').click();
      TestBed.tick();
      const put = http().expectOne({ method: 'PUT', url: '/api/plan/2026-10-26' });
      expect(put.request.body).toEqual({ recipe_id: 9, portions: 4 });
      put.flush(day('2026-10-26', KJOTTKAKER));
      await settle(harness);

      const flash = page(harness).querySelector('.flash');
      expect(text(flash)).toBe('Lagt til mandag 26. oktober. Se ukeplanen');
      expect(flash?.querySelector('a')?.getAttribute('href')).toBe('/ukeplan?uke=2026-W44');
      expect(page(harness).querySelector('.plan-pick')).toBeNull();
    });

    it('asks before it replaces a taken day', async () => {
      const harness = await openPicker();
      const el = page(harness);
      button(el, 'Fredag 23. okt').click();
      await harness.fixture.whenStable();
      expect(http().match((r) => r.method === 'PUT')).toEqual([]);
      expect(text(el.querySelector('.confirm h3'))).toBe('Fredag har Taco');
      expect(text(el.querySelector('.confirm p'))).toBe(
        'Legger dere til Kjøttkaker i brun saus, erstatter den Taco.',
      );

      button(el, 'Bytt til Kjøttkaker i brun saus').click();
      TestBed.tick();
      http()
        .expectOne({ method: 'PUT', url: '/api/plan/2026-10-23' })
        .flush(day('2026-10-23', KJOTTKAKER));
      await settle(harness);
      expect(text(page(harness).querySelector('.flash'))).toBe(
        'Lagt til fredag 23. oktober. Se ukeplanen',
      );
    });

    for (const [who, me] of [
      ['an anonymous visitor', READER],
      ['a signed-in non-editor', OUTSIDER],
    ] as const) {
      it(`is not there for ${who}`, async () => {
        const el = await open('/recipes/9', { me, recipe: seed(9) });
        expect(text(el.querySelector('h1'))).toBe('Kjøttkaker i brun saus');
        expect([...el.querySelectorAll('button')].map((b) => text(b))).not.toContain(
          'Legg til i ukeplan',
        );
      });
    }
  });
});
