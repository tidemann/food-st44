// ST-1962: ingredient groups and method phases, on the recipe page and on the form
// (ST-1966 §6, acceptance criteria 1–9).
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Recipe } from '../api/types';
import { open, openHarness, page, seed, setUp, text } from '../../testing/app';
import { field, fill, reject, submit } from '../../testing/form';
import { phasesFor, recipeSteps } from './format';
import {
  blockSummary,
  mergeGroups,
  mergePhases,
  move,
  newGroup,
  newPhase,
  rowsFor,
} from './structure';

/** Asiatisk tynnribbe (ST-1966), shortened: three groups, three phases, one without a time. */
const ribbe: Recipe = {
  ...seed(9),
  id: 20,
  title: 'Asiatisk tynnribbe på Traeger',
  ingredients: '2 ss brunt sukker\n1 ss five spice\n2 ss soyasaus\nen skvis lime\n4 ss hoisinsaus',
  instructions: 'Bland alt i ruben.\n\nGni ruben inn.\n\nRøyk i tre timer.\n\nBland glazen.',
  ingredient_groups: [
    { title: 'Rub', ingredients: '2 ss brunt sukker\n1 ss five spice' },
    { title: 'Væske i formen', ingredients: '2 ss soyasaus\nen skvis lime' },
    { title: 'Glaze', ingredients: '4 ss hoisinsaus' },
  ],
  phases: [
    {
      title: 'Rub',
      time: 'Gjerne dagen før',
      instructions: 'Bland alt i ruben.\n\nGni ruben inn.',
    },
    { title: 'Røyk', time: '3 timer på 110–120 °C', instructions: 'Røyk i tre timer.' },
    { title: 'Glaze', time: '', instructions: 'Bland glazen.' },
  ],
};

const all = (el: HTMLElement, selector: string): string[] =>
  [...el.querySelectorAll(selector)].map((found) => text(found));

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function byText(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => text(candidate) === label,
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

describe('ingredient groups and phases (ST-1962)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('the recipe page', () => {
    it('draws a plain recipe exactly as before: no <h3>, no group, no phase', async () => {
      const el = await open('/recipes/9', { recipe: seed(9) });
      const ing = el.querySelector('.ing');
      expect(ing?.querySelector(':scope > h2 + ul')).not.toBeNull();
      expect(el.querySelectorAll('.rbody h3, .ing-group, .phase, .phase-none').length).toBe(0);
      expect(all(el, '.step .n')).toEqual(['1', '2', '3']);
    });

    it('titles the groups and numbers the steps through the whole recipe', async () => {
      const el = await open('/recipes/20', { recipe: ribbe });
      expect(all(el, '.ing-group > h3')).toEqual(['Rub', 'Væske i formen', 'Glaze']);
      expect(all(el, '.ing-group:nth-of-type(2) li span')).toEqual(['soyasaus', 'en skvis lime']);
      expect(all(el, '.phase-head > h3')).toEqual(['Rub', 'Røyk', 'Glaze']);
      // The time is optional: Glaze has none, and no empty element stands in for it.
      expect(all(el, '.phase-time')).toEqual(['Gjerne dagen før', '3 timer på 110–120 °C']);
      expect(all(el, '.phase:nth-of-type(2) .step .n')).toEqual(['3']);
      expect(all(el, '.step .n')).toEqual(['1', '2', '3', '4']);
      const facts = all(el, '.rmeta dl > div');
      expect(facts).toContain('Fremgangsmåte4 steg');
      expect(facts).toContain('Ingredienser5');
    });

    it('says so in a phase without steps, and marks an untitled group among titled ones', async () => {
      const odd: Recipe = {
        ...ribbe,
        ingredient_groups: [
          { title: 'Rub', ingredients: 'salt' },
          { title: '', ingredients: 'pepper' },
        ],
        phases: [
          { title: 'Rub', time: '', instructions: 'Gni inn.' },
          { title: 'Hvile', time: '', instructions: '' },
        ],
      };
      const el = await open('/recipes/20', { recipe: odd });
      expect(el.querySelectorAll('.ing-group').length).toBe(2);
      expect(el.querySelector('.ing-group:nth-of-type(2) h3')).toBeNull();
      expect(text(el.querySelector('.phase-none'))).toBe(
        'Ingen steg i denne fasen ennå. Skriv dem inn.',
      );
      expect(el.querySelector('.phase-none a')?.getAttribute('href')).toBe('/recipes/20/edit');
    });
  });

  describe('the form', () => {
    it('keeps a plain recipe one list, with the two links to split it', async () => {
      const el = await open('/recipes/9/edit', { recipe: seed(9) });
      expect(el.querySelector('.blocks')).toBeNull();
      expect(all(el, '.split .mini')).toEqual(['Del opp i grupper', 'Del opp i faser']);
    });

    it('shows each group and phase as a block with its actions', async () => {
      const el = await open('/recipes/20/edit', { recipe: ribbe });
      expect(all(el, '.block-n')).toEqual([
        'Gruppe 1 av 3',
        'Gruppe 2 av 3',
        'Gruppe 3 av 3',
        'Fase 1 av 3',
        'Fase 2 av 3',
        'Fase 3 av 3',
      ]);
      expect(field(el, 'group-1-title').value).toBe('Væske i formen');
      expect(field(el, 'phase-1-time').value).toBe('3 timer på 110–120 °C');
      expect(field(el, 'phase-0-instructions').value).toBe('Bland alt i ruben.\n\nGni ruben inn.');
      // First and last keep their move in the row, unavailable by more than colour.
      expect(button(el, 'Flytt gruppen «Rub» opp').getAttribute('aria-disabled')).toBe('true');
      expect(button(el, 'Flytt gruppen «Rub» ned').getAttribute('aria-disabled')).toBeNull();
      expect(button(el, 'Flytt gruppen «Glaze» ned').getAttribute('aria-disabled')).toBe('true');
      expect(button(el, 'Fjern fasen «Røyk»')).toBeTruthy();
    });

    it('moves a group, says so, and saves the new order', async () => {
      const harness = await openHarness('/recipes/20/edit', { recipe: ribbe });
      const el = page(harness);
      button(el, 'Flytt gruppen «Glaze» opp').click();
      await harness.fixture.whenStable();

      expect(all(el, '.block-n + .block-acts')).toHaveLength(6);
      expect(field(el, 'group-1-title').value).toBe('Glaze');
      expect(text(el.querySelector('#blocks-status'))).toBe(
        'Gruppen «Glaze» er flyttet opp, til nummer 2.',
      );
      expect(document.activeElement).toBe(el.querySelector('#group-1-opp'));
      // At the top the button does nothing.
      button(el, 'Flytt gruppen «Rub» opp').click();
      await harness.fixture.whenStable();
      expect(field(el, 'group-0-title').value).toBe('Rub');

      const request = submit(el, 'PUT', '/api/recipes/20');
      expect(request.request.body).toMatchObject({
        ingredients: '',
        ingredient_groups: [
          { title: 'Rub', ingredients: '2 ss brunt sukker\n1 ss five spice' },
          { title: 'Glaze', ingredients: '4 ss hoisinsaus' },
          { title: 'Væske i formen', ingredients: '2 ss soyasaus\nen skvis lime' },
        ],
        instructions: '',
        phases: ribbe.phases,
      });
      request.flush(ribbe);
    });

    it('splits a plain list, adds a group and removes it again', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: seed(9) });
      const el = page(harness);
      byText(el, 'Del opp i grupper').click();
      await harness.fixture.whenStable();

      expect(all(el, '.block-n')).toEqual(['Gruppe 1 av 1']);
      expect(field(el, 'group-0-ingredients').value).toBe(seed(9).ingredients);
      expect(document.activeElement).toBe(el.querySelector('#group-0-title'));

      byText(el, 'Legg til gruppe').click();
      await harness.fixture.whenStable();
      expect(all(el, '.block-n')).toEqual(['Gruppe 1 av 2', 'Gruppe 2 av 2']);
      expect(document.activeElement).toBe(el.querySelector('#group-1-title'));

      button(el, 'Fjern gruppe 2').click();
      await harness.fixture.whenStable();
      expect(all(el, '.block-n')).toEqual(['Gruppe 1 av 1']);
      expect(text(el.querySelector('#blocks-status'))).toBe('Gruppe 2 er fjernet.');
    });

    it('asks before it merges the groups into one list', async () => {
      const harness = await openHarness('/recipes/20/edit', { recipe: ribbe });
      const el = page(harness);
      byText(el, 'Slå sammen til én liste').click();
      await harness.fixture.whenStable();

      expect(text(el.querySelector('.split-confirm span'))).toBe(
        'Titlene på gruppene forsvinner når listene slås sammen.',
      );
      byText(el, 'Avbryt').click();
      await harness.fixture.whenStable();
      expect(el.querySelector('.split-confirm')).toBeNull();
      expect(all(el, '.block-n')).toHaveLength(6);

      byText(el, 'Slå sammen til én liste').click();
      await harness.fixture.whenStable();
      byText(el, 'Slå sammen').click();
      await harness.fixture.whenStable();
      expect(field(el, 'ingredients').value).toBe(ribbe.ingredients);
      expect(all(el, '.block-n')).toEqual(['Fase 1 av 3', 'Fase 2 av 3', 'Fase 3 av 3']);
      expect(document.activeElement).toBe(el.querySelector('#ingredients'));

      const request = submit(el, 'PUT', '/api/recipes/20');
      expect(request.request.body).not.toHaveProperty('ingredient_groups');
      expect(request.request.body).toMatchObject({ ingredients: ribbe.ingredients });
      request.flush(ribbe);
    });

    it('shows the API errors in the summary, naming the block, and under the field', async () => {
      const harness = await openHarness('/recipes/20/edit', { recipe: ribbe });
      const el = page(harness);
      fill(el, 'group-1-title', '');
      fill(el, 'phase-1-instructions', '');
      reject(submit(el, 'PUT', '/api/recipes/20'), {
        'ingredient_groups.1.title': 'Gruppen må ha en tittel når oppskriften har flere grupper.',
        'phases.1.instructions': 'Skriv inn minst ett steg, eller fjern fasen.',
      });
      await harness.fixture.whenStable();

      expect(all(el, '.alert li')).toEqual([
        'Gruppe 2 må ha en tittel når oppskriften har flere grupper.',
        'Fase 2 «Røyk» må ha minst ett steg.',
      ]);
      expect(text(el.querySelector('#group-1-title-error'))).toBe(
        'Gruppen må ha en tittel når oppskriften har flere grupper.',
      );
      expect(field(el, 'phase-1-instructions').getAttribute('aria-invalid')).toBe('true');
      el.querySelector<HTMLAnchorElement>('.alert li:last-child a')?.click();
      expect(document.activeElement).toBe(el.querySelector('#phase-1-instructions'));
    });
  });

  describe('the helpers', () => {
    it('numbers the steps through the phases', () => {
      expect(recipeSteps(ribbe)).toEqual([
        'Bland alt i ruben.',
        'Gni ruben inn.',
        'Røyk i tre timer.',
        'Bland glazen.',
      ]);
      expect(phasesFor(ribbe).map((phase) => phase.start)).toEqual([0, 2, 3]);
      expect(recipeSteps({ ...ribbe, phases: [] })).toHaveLength(4);
    });

    it('moves within the list only', () => {
      expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
      expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
      expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
      expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    });

    it('merges in order and skips empty blocks', () => {
      expect(mergeGroups([newGroup('salt\n'), newGroup(''), newGroup('pepper')])).toBe(
        'salt\npepper',
      );
      expect(mergePhases([newPhase('Gni inn.'), newPhase(' '), newPhase('Server.')])).toBe(
        'Gni inn.\n\nServer.',
      );
    });

    it('sizes a field to its text', () => {
      expect(rowsFor('')).toBe(3);
      expect(rowsFor('a\nb\nc\nd')).toBe(5);
    });

    it('names an untitled block by its number', () => {
      const phases = [newPhase('x'), { ...newPhase(), title: 'Røyk' }];
      expect(blockSummary('phases.0.title', 'x', [], phases)).toBe('Fase 1 må ha en tittel.');
      expect(blockSummary('phases.1.instructions', 'x', [], phases)).toBe(
        'Fase 2 «Røyk» må ha minst ett steg.',
      );
      expect(blockSummary('ingredient_groups.0.ingredients', 'x', [newGroup()], [])).toBe(
        'Gruppe 1 må ha minst én ingrediens.',
      );
    });
  });
});
