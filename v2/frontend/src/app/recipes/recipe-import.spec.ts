import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RouterTestingHarness } from '@angular/router/testing';
import type { Recipe, RecipeDraft, TextDraft } from '../api/types';
import {
  answer,
  open,
  openHarness,
  OUTSIDER,
  page,
  READER,
  setUp,
  text,
  title,
} from '../../testing/app';
import { field, fill, navigation, submit } from '../../testing/form';
import { LINK_URL, NOT_IMPORTED, TEXT_URL } from './import';

const URL = 'https://www.matprat.no/oppskrifter/familien/aspargessuppe/';
const DRAFT: RecipeDraft = {
  readable: true,
  title: 'Aspargessuppe',
  ingredients: '500 g frisk grønn asparges\n1 stk. løk\n2 dl matfløte',
  instructions: 'Skrell aspargesen.\nKok suppen.',
};
const UNREADABLE: RecipeDraft = { readable: false, title: '', ingredients: '', instructions: '' };
const PASTED = 'Aspargessuppe\n\nIngredienser\n500 g asparges\n\nFremgangsmåte\nKok suppen.';
const FROM_TEXT: TextDraft = {
  readable: true,
  title: 'Aspargessuppe',
  ingredients: '500 g asparges',
  instructions: 'Kok suppen.',
  read_by: 'ai',
  notice: '',
};
const RULES_OFF = 'Lesing med KI er ikke slått på, så teksten er delt opp etter enkle regler.';
const BLOCKED =
  'Nettstedet ville ikke gi oss siden. Noen nettsteder stenger ute alt som ikke er en ' +
  'nettleser. Lim inn teksten i stedet, eller skriv inn oppskriften selv.';

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

async function settle(harness: RouterTestingHarness): Promise<HTMLElement> {
  await harness.fixture.whenStable();
  return page(harness);
}

/** Fills in the link or the text and presses the button; returns the request it sent. */
function send(el: HTMLElement, id: 'url' | 'text', value: string, url: string): TestRequest {
  fill(el, id, value);
  return submit(el, 'POST', url);
}

function buttons(el: HTMLElement, selector: string): string[][] {
  return [...el.querySelectorAll(selector)].map((b) => [text(b), b.getAttribute('href') ?? '']);
}

function press(el: HTMLElement, label: string): void {
  [...el.querySelectorAll('button')].find((b) => text(b) === label)?.click();
}

describe('RecipeImport', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  describe('the buttons on "Ny oppskrift"', () => {
    it('offers a link and pasted text at the top of the form, with or without reading', async () => {
      const el = await open('/recipes/new');
      expect(buttons(el, '.import-from a')).toEqual([
        ['Hent fra lenke', '/recipes/new/link'],
        ['Lim inn tekst', '/recipes/new/text'],
      ]);
      expect(text(el.querySelector('.import-from p'))).toBe(
        'Har du oppskriften på nettet eller i en annen app? Så fyller vi ut skjemaet.',
      );
      expect(el.querySelector('.import-from')?.compareDocumentPosition(field(el, 'title'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it('puts the photo first when reading is on', async () => {
      const el = await open('/recipes/new', { reading: { available: true } });
      expect(buttons(el, '.import-from a').map(([label]) => label)).toEqual([
        'Les oppskrift fra bilde',
        'Hent fra lenke',
        'Lim inn tekst',
      ]);
    });
  });

  describe('who gets the screens', () => {
    it.each([
      ['nobody signed in', '/recipes/new/link', READER, 'Logg inn for å endre'],
      ['nobody signed in', '/recipes/new/text', READER, 'Logg inn for å endre'],
      ['an account not on the list', '/recipes/new/link', OUTSIDER, 'Ingen tilgang'],
      ['an account not on the list', '/recipes/new/text', OUTSIDER, 'Ingen tilgang'],
    ])('gives %s the no-access page on %s', async (_who, url, me, heading) => {
      const el = await open(url, { me });
      expect(text(el.querySelector('h1'))).toBe(heading);
      expect(el.querySelector('form')).toBeNull();
    });
  });

  describe('Hent fra lenke', () => {
    it('asks for the link, with tips and the way back to typing', async () => {
      const el = await open('/recipes/new/link');
      expect(title()).toBe('Hent oppskrift fra lenke — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Hent oppskrift fra lenke');
      expect(text(el.querySelector('label'))).toBe('Lenke til oppskriften');
      expect(field(el, 'url').getAttribute('type')).toBe('url');
      expect(field(el, 'url').getAttribute('aria-describedby')).toBe('url-hint');
      expect(text(el.querySelector('button[type="submit"]'))).toBe('Hent oppskriften');
      expect(text(el.querySelector('.tips h2'))).toBe('Dette fungerer best');
      expect(el.querySelectorAll('.tips li')).toHaveLength(3);
      expect(buttons(el, '.tips-manual a')).toEqual([
        ['skriv oppskriften inn selv', '/recipes/new'],
      ]);
    });

    it('sends the link, says it is fetching, and "Avbryt" drops the request', async () => {
      const harness = await openHarness('/recipes/new/link');
      const request = send(page(harness), 'url', URL, LINK_URL);
      expect(request.request.body).toEqual({ url: URL });
      let el = await settle(harness);
      expect(text(el.querySelector('.reading h2'))).toBe('Henter oppskriften…');
      expect(el.querySelector('.reading')?.getAttribute('role')).toBe('status');
      expect(document.activeElement && text(document.activeElement)).toBe('Avbryt');
      expect(el.querySelector('form')).toBeNull();

      press(el, 'Avbryt');
      el = await settle(harness);
      expect(request.cancelled).toBe(true);
      expect(field(el, 'url').value).toBe(URL);
    });

    it('fills the normal form, says where from, and saves nothing yet', async () => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', URL, LINK_URL).flush(DRAFT);
      const el = await settle(harness);

      expect(title()).toBe('Les gjennom oppskriften — food.st44.no');
      expect(document.activeElement).toBe(el.querySelector('h1'));
      expect(text(el.querySelector('.form-head p'))).toBe('Hentet fra www.matprat.no.');
      expect(text(el.querySelector('.check-note .alert-title'))).toBe(
        'Sjekk teksten før du lagrer',
      );
      expect(field(el, 'title').value).toBe(DRAFT.title);
      expect(field(el, 'ingredients').value).toBe(DRAFT.ingredients);
      expect(field(el, 'instructions').value).toBe(DRAFT.instructions);
      const source = el.querySelector('.source-link a');
      expect([text(source), source?.getAttribute('href'), source?.getAttribute('rel')]).toEqual([
        'www.matprat.no',
        URL,
        'noopener noreferrer',
      ]);
      http().expectNone({ url: '/api/recipes' });
    });

    it('saves what the editor checked', async () => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', URL, LINK_URL).flush(DRAFT);
      const el = await settle(harness);
      fill(el, 'title', 'Aspargessuppe med urter');

      const request = submit(el, 'POST', '/api/recipes');
      expect(request.request.body).toEqual({
        title: 'Aspargessuppe med urter',
        ingredients: DRAFT.ingredients,
        instructions: DRAFT.instructions,
        tags: [],
      });
      const created: Recipe = {
        id: 10,
        title: 'Aspargessuppe med urter',
        ingredients: DRAFT.ingredients,
        instructions: DRAFT.instructions,
        created_at: '2026-10-05T10:00:00Z',
        photo_url: null,
        tags: [],
      };
      const navigated = navigation();
      request.flush(created, { status: 201, statusText: 'Created' });
      expect((await navigated).url).toBe('/recipes/10?flash=created');
      answer({ recipe: created });
    });

    it('"Bytt lenke" goes back with the link kept', async () => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', URL, LINK_URL).flush(DRAFT);
      let el = await settle(harness);
      press(el, 'Bytt lenke');
      el = await settle(harness);
      expect(el.querySelector('.recipe-form')).toBeNull();
      expect(field(el, 'url').value).toBe(URL);
    });

    it('says so when the page has no recipe, and offers the ways on', async () => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', URL, LINK_URL).flush(UNREADABLE);
      const el = await settle(harness);

      expect(title()).toBe('Fant ingen oppskrift på siden — food.st44.no');
      expect(text(el.querySelector('.unreadable-lead'))).toBe(
        'Siden har ingen oppskrift vi kan lese. Ingenting er lagret. Kopier teksten fra siden ' +
          'og lim den inn, eller skriv inn oppskriften selv.',
      );
      expect(text(el.querySelector('.unreadable-name'))).toBe('www.matprat.no');
      expect(text(el.querySelector('.unreadable-meta'))).toBe(URL);
      expect(buttons(el, '.notice-actions > *')).toEqual([
        ['Prøv en annen lenke', ''],
        ['Lim inn tekst', '/recipes/new/text'],
        ['Skriv den inn selv', '/recipes/new'],
      ]);
      expect(el.querySelector('form')).toBeNull();
    });

    it.each([
      ['refused (502)', 502],
      ['too slow (504)', 504],
    ])('passes on the site failing: %s', async (_case, status) => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', URL, LINK_URL).flush(
        { detail: BLOCKED },
        { status, statusText: 'Error' },
      );
      let el = await settle(harness);
      expect(text(el.querySelector('h1'))).toBe('Fikk ikke hentet oppskriften');
      expect(text(el.querySelector('.unreadable-lead'))).toBe(BLOCKED);

      press(el, 'Prøv en annen lenke');
      el = await settle(harness);
      expect(field(el, 'url').value).toBe(URL);
      expect(document.activeElement).toBe(el.querySelector('h1'));
    });

    it.each([
      [
        'a link it will not fetch (422)',
        422,
        { errors: { url: 'Den lenken kan vi ikke hente fra.' } },
        'Den lenken kan vi ikke hente fra.',
      ],
      ['refused (403)', 403, { detail: 'Forbidden' }, NOT_IMPORTED],
      ['a 502 with no words', 502, '<html>502</html>', NOT_IMPORTED],
    ])('says why under the field: %s', async (_case, status, body, message) => {
      const harness = await openHarness('/recipes/new/link');
      send(page(harness), 'url', 'http://10.0.0.1/', LINK_URL).flush(body, {
        status,
        statusText: 'Error',
      });
      const el = await settle(harness);
      expect(text(el.querySelector('#url-error'))).toBe(message);
      expect(el.querySelector('#url-error')?.getAttribute('role')).toBe('alert');
      expect(field(el, 'url').getAttribute('aria-invalid')).toBe('true');
      expect(field(el, 'url').getAttribute('aria-describedby')).toBe('url-hint url-error');
      expect(field(el, 'url').value).toBe('http://10.0.0.1/');
    });
  });

  describe('Lim inn tekst', () => {
    it('asks for the text', async () => {
      const el = await open('/recipes/new/text');
      expect(title()).toBe('Lim inn oppskrift — food.st44.no');
      expect(text(el.querySelector('label'))).toBe('Teksten til oppskriften');
      expect(field(el, 'text').tagName).toBe('TEXTAREA');
      expect(text(el.querySelector('button[type="submit"]'))).toBe('Les teksten');
    });

    it('sends the text, says it is reading, and "Avbryt" drops the request', async () => {
      const harness = await openHarness('/recipes/new/text');
      const request = send(page(harness), 'text', PASTED, TEXT_URL);
      expect(request.request.body).toEqual({ text: PASTED });
      let el = await settle(harness);
      expect(text(el.querySelector('.reading h2'))).toBe('Leser teksten…');
      expect(text(el.querySelector('.reading p'))).toBe('Det kan ta opptil et halvt minutt.');
      expect(document.activeElement && text(document.activeElement)).toBe('Avbryt');

      press(el, 'Avbryt');
      el = await settle(harness);
      expect(request.cancelled).toBe(true);
      expect(field(el, 'text').value).toBe(PASTED);
    });

    it('fills the form from the AI read and shows the text beside it', async () => {
      const harness = await openHarness('/recipes/new/text');
      send(page(harness), 'text', PASTED, TEXT_URL).flush(FROM_TEXT);
      let el = await settle(harness);

      expect(text(el.querySelector('.form-head p'))).toBe('Lest fra teksten du limte inn.');
      expect(text(el.querySelector('.check-note p:last-child'))).toBe(
        'Teksten er lest av KI og kan ha feil. Rett det som er galt — ingenting er lagret ennå.',
      );
      expect(el.querySelector('.read-notice')).toBeNull();
      expect(field(el, 'title').value).toBe('Aspargessuppe');
      expect(field(el, 'ingredients').value).toBe('500 g asparges');
      expect(el.querySelector('.source-text')?.textContent).toBe(PASTED);
      http().expectNone({ url: '/api/recipes' });

      press(el, 'Rett teksten');
      el = await settle(harness);
      expect(field(el, 'text').value).toBe(PASTED);
    });

    it('says so on the form when the text was split by rules instead', async () => {
      const harness = await openHarness('/recipes/new/text');
      send(page(harness), 'text', PASTED, TEXT_URL).flush({
        ...FROM_TEXT,
        read_by: 'rules',
        notice: RULES_OFF,
      });
      const el = await settle(harness);

      expect(text(el.querySelector('.form-head p'))).toBe('Delt opp fra teksten du limte inn.');
      expect(text(el.querySelector('.read-notice'))).toBe(RULES_OFF);
      expect(text(el.querySelector('.check-note p:last-child'))).toBe(
        'Teksten er delt opp etter enkle regler, og noe kan ha havnet i feil felt. Rett det ' +
          'som er galt — ingenting er lagret ennå.',
      );
      expect(field(el, 'ingredients').value).toBe('500 g asparges');
    });

    it('says so when the text holds no recipe', async () => {
      const harness = await openHarness('/recipes/new/text');
      send(page(harness), 'text', 'Ingredienser', TEXT_URL).flush(UNREADABLE);
      const el = await settle(harness);
      expect(text(el.querySelector('h1'))).toBe('Fant ingen oppskrift i teksten');
      expect(buttons(el, '.notice-actions > *')).toEqual([
        ['Rett teksten', ''],
        ['Skriv den inn selv', '/recipes/new'],
      ]);
    });

    it('shows the API error under the field', async () => {
      const harness = await openHarness('/recipes/new/text');
      send(page(harness), 'text', ' ', TEXT_URL).flush(
        { errors: { text: 'Lim inn teksten til oppskriften.' } },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      const el = await settle(harness);
      expect(text(el.querySelector('#text-error'))).toBe('Lim inn teksten til oppskriften.');
      expect(field(el, 'text').getAttribute('aria-invalid')).toBe('true');
    });

    it('says so when the request never reached the API', async () => {
      const harness = await openHarness('/recipes/new/text');
      send(page(harness), 'text', PASTED, TEXT_URL).error(new ProgressEvent('error'));
      const el = await settle(harness);
      expect(text(el.querySelector('#text-error'))).toBe(NOT_IMPORTED);
    });
  });
});
