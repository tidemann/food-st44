import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Me, Recipe, RecipeDraft } from '../api/types';
import {
  answer,
  EDITOR,
  open,
  OUTSIDER,
  page,
  READER,
  READING,
  setUp,
  signIn,
  text,
  title,
} from '../../testing/app';
import { choose, field, fill, navigation, photoFile, submit } from '../../testing/form';
import { NOT_AN_IMAGE, TOO_LARGE } from './photo';
import { NOT_READ } from './read-photo';

const DRAFT: RecipeDraft = {
  readable: true,
  title: 'Kjøttkaker i brun saus',
  ingredients: '600 g kjøttdeig\n1 dl melk\n2 ss potetmel',
  instructions: 'Bland kjøttdeigen med salt.\n\nForm kaker og brun dem.',
};
const UNREADABLE: RecipeDraft = { readable: false, title: '', ingredients: '', instructions: '' };
const TIMED_OUT =
  'Det tok for lang tid å lese bildet. Prøv igjen, eller skriv inn oppskriften selv.';
const TIPS = [
  'Hold kameraet rett over siden, så teksten ikke skråner.',
  'God belysning, og ingen skygge eller finger over teksten.',
  'Én oppskrift om gangen — ikke et oppslag med to sider.',
];

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

/**
 * Opens `/recipes/new/photo`. Its route asks the API whether reading is on before it matches, so
 * that answer comes while the navigation is still under way.
 */
async function openReader(available = true, me: Me = EDITOR): Promise<RouterTestingHarness> {
  const harness = await RouterTestingHarness.create();
  signIn(me);
  let done = false;
  void harness.navigateByUrl('/recipes/new/photo').then(() => {
    done = true;
  });
  await vi.waitFor(() => {
    for (const request of http().match({ method: 'GET', url: READING })) {
      request.flush({ available });
    }
    if (!done) throw new Error('still navigating');
  });
  answer({});
  await harness.fixture.whenStable();
  return harness;
}

/** Picks the cookbook page and returns the read request it sent. */
function pick(el: HTMLElement, file = photoFile('oppskrift-kort.jpg', 'image/jpeg')): TestRequest {
  choose(el, file, 'source');
  return http().expectOne({ method: 'POST', url: READING });
}

async function settle(harness: RouterTestingHarness): Promise<HTMLElement> {
  await harness.fixture.whenStable();
  return page(harness);
}

describe('RecipeFromPhoto', () => {
  beforeEach(() => {
    setUp();
    // jsdom decodes no images: hand back a bitmap the size of a scanned card, and no canvas.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 2048, height: 1536, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    http().verify();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('the button on "Ny oppskrift"', () => {
    it('is at the top of the form when reading is on', async () => {
      const el = await open('/recipes/new', { reading: { available: true } });
      const link = el.querySelector('.import-from a');
      expect([text(link), link?.getAttribute('href')]).toEqual([
        'Les oppskrift fra bilde',
        '/recipes/new/photo',
      ]);
      // Above the form, not in the top bar.
      expect(link?.compareDocumentPosition(field(el, 'title'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(text(el.querySelector('.import-from p'))).toBe(
        'Har du oppskriften på papir, på nettet eller i en annen app? Så fyller vi ut skjemaet.',
      );
    });

    it.each([
      ['reading is off', { available: false }],
      ['the answer failed', 500],
    ])('is not there when %s', async (_case, reading) => {
      const el = await open('/recipes/new', { reading });
      expect(el.querySelector('form')).not.toBeNull();
      expect(el.querySelector('a[href="/recipes/new/photo"]')).toBeNull();
    });
  });

  describe('who gets the screen', () => {
    it('sends an editor to the form when reading is off', async () => {
      const harness = await openReader(false);
      expect(TestBed.inject(Router).url).toBe('/recipes/new');
      expect(text(page(harness).querySelector('h1'))).toBe('Ny oppskrift');
    });

    it.each([
      ['nobody signed in', READER, 'Logg inn for å endre'],
      ['an account not on the list', OUTSIDER, 'Ingen tilgang'],
    ])('gives %s the no-access page and no file field', async (_who, me, heading) => {
      const el = page(await openReader(false, me));
      expect(text(el.querySelector('h1'))).toBe(heading);
      expect(el.querySelector('input[type="file"], form')).toBeNull();
    });
  });

  describe('row 7: take or pick a photo', () => {
    it('offers the camera and the file, the tips and the way back to typing', async () => {
      const el = page(await openReader());
      expect(title()).toBe('Les oppskrift fra bilde — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Les oppskrift fra bilde');
      expect(text(el.querySelector('.form-head p'))).toBe(
        'Ta et bilde av oppskriften. Vi fyller ut skjemaet, du leser gjennom og lagrer.',
      );
      expect(text(el.querySelector('legend'))).toBe('Bilde av oppskriften');
      expect(text(el.querySelector('#source-hint'))).toBe(
        'En side i en kokebok, et utklipp eller et håndskrevet kort. JPEG, PNG eller WEBP, høyst 25 MB.',
      );
      expect([...el.querySelectorAll('.source button')].map(text)).toEqual([
        'Ta bilde av oppskriften',
        'Velg bilde',
      ]);
      const camera = el.querySelector('#source-camera');
      expect(camera?.getAttribute('capture')).toBe('environment');
      for (const input of [el.querySelector('#source'), camera]) {
        expect(input?.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
      }
      expect(text(el.querySelector('.tips h2'))).toBe('Dette leses best');
      expect([...el.querySelectorAll('.tips li')].map(text)).toEqual(TIPS);
      const manual = el.querySelector('.tips-manual a');
      expect([text(manual), manual?.getAttribute('href')]).toEqual([
        'skriv oppskriften inn selv',
        '/recipes/new',
      ]);
      expect(el.querySelector('.field-error')).toBeNull();
    });

    it('refuses a file that is not a photo, or too large, before sending it', async () => {
      const harness = await openReader();
      const el = page(harness);
      choose(el, photoFile('oppskrift.pdf', 'application/pdf'), 'source');
      await settle(harness);
      expect(text(el.querySelector('#source-error'))).toBe(NOT_AN_IMAGE);
      expect(el.querySelector('.source')?.classList).toContain('field-invalid');

      choose(el, photoFile('stor.jpg', 'image/jpeg', 30 * 2 ** 20), 'source-camera');
      await settle(harness);
      expect(text(el.querySelector('#source-error'))).toBe(TOO_LARGE);
      http().expectNone({ method: 'POST' });
    });
  });

  describe('row 8: reading', () => {
    it('sends only the photo, says it is reading and shows the photo', async () => {
      const harness = await openReader();
      const file = photoFile('oppskrift-kort.jpg', 'image/jpeg');
      const request = pick(page(harness), file);
      const el = await settle(harness);

      const body = request.request.body as FormData;
      expect([...body.keys()]).toEqual(['photo']);
      expect(body.get('photo')).toBe(file);

      expect(text(el.querySelector('.reading h2'))).toBe('Leser oppskriften…');
      expect(text(el.querySelector('.reading p'))).toBe(
        'Det tar vanligvis under et halvt minutt. Du kan bli stående her.',
      );
      expect(el.querySelector('.reading')?.getAttribute('role')).toBe('status');
      expect(el.querySelector('canvas')?.getAttribute('aria-label')).toBe('Bildet du tok');
      expect(text(el.querySelector('figcaption'))).toBe('Bildet du tok');
      expect(document.activeElement && text(document.activeElement)).toBe('Avbryt');
      // No form yet, and nothing saved.
      expect(el.querySelector('form')).toBeNull();
      request.flush(DRAFT);
    });

    it('"Avbryt" drops the request and goes back to choosing', async () => {
      const harness = await openReader();
      const request = pick(page(harness));
      let el = await settle(harness);
      [...el.querySelectorAll('button')].find((b) => text(b) === 'Avbryt')?.click();
      el = await settle(harness);

      expect(request.cancelled).toBe(true);
      expect(el.querySelector('.reading')).toBeNull();
      expect(el.querySelector('#source')).not.toBeNull();
      expect(el.querySelector('.field-error')).toBeNull();
    });
  });

  describe('row 9: check', () => {
    it('fills the normal form, with the photo beside it, and saves nothing yet', async () => {
      const harness = await openReader();
      pick(page(harness)).flush(DRAFT);
      const el = await settle(harness);

      expect(title()).toBe('Les gjennom oppskriften — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Les gjennom oppskriften');
      expect(document.activeElement).toBe(el.querySelector('h1'));
      expect(text(el.querySelector('.form-head p'))).toMatch(/^Lest fra bildet \d+\. \S+ \d{4}\.$/);
      expect(text(el.querySelector('.check-note'))).toBe(
        'Sjekk teksten før du lagrer Alt under er lest av maskinen og kan ha feil, særlig mengder. ' +
          'Rett det som er galt — ingenting er lagret ennå.',
      );
      expect(field(el, 'title').value).toBe(DRAFT.title);
      expect(field(el, 'ingredients').value).toBe(DRAFT.ingredients);
      expect(field(el, 'instructions').value).toBe(DRAFT.instructions);
      expect(text(el.querySelector('button[type="submit"]'))).toBe('Lagre oppskrift');
      expect(text(el.querySelector('.source-photo figcaption span'))).toBe('Bildet du tok');
      expect(text(el.querySelector('.source-photo figcaption button'))).toBe('Bytt bilde');
      http().expectNone({ url: '/api/recipes' });
    });

    it('saves what the editor fixed, and never the cookbook page', async () => {
      const harness = await openReader();
      pick(page(harness)).flush(DRAFT);
      const el = await settle(harness);
      fill(el, 'title', 'Kjøttkaker i brun saus (mormor)');
      fill(el, 'ingredients', '600 g kjøttdeig\n1 dl melk\n3 ss potetmel');

      const request = submit(el, 'POST', '/api/recipes');
      expect(request.request.body).toEqual({
        title: 'Kjøttkaker i brun saus (mormor)',
        ingredients: '600 g kjøttdeig\n1 dl melk\n3 ss potetmel',
        instructions: DRAFT.instructions,
      });
      const created: Recipe = {
        id: 10,
        title: 'Kjøttkaker i brun saus (mormor)',
        ingredients: '600 g kjøttdeig\n1 dl melk\n3 ss potetmel',
        instructions: DRAFT.instructions,
        created_at: '2026-10-05T10:00:00Z',
        photo_url: null,
      };
      const navigated = navigation();
      request.flush(created, { status: 201, statusText: 'Created' });
      // No photo request follows: the form's own photo field was left empty.
      expect((await navigated).url).toBe('/recipes/10?flash=created');
      answer({ recipe: created });
      await harness.fixture.whenStable();
      expect(text(page(harness).querySelector('.flash'))).toBe('Oppskriften ble lagret.');
    });

    it('shows the API errors like the normal form', async () => {
      const harness = await openReader();
      pick(page(harness)).flush({ ...DRAFT, title: '' });
      const el = await settle(harness);
      submit(el, 'POST', '/api/recipes').flush(
        { errors: { title: 'Tittelen må fylles ut.' } },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await harness.fixture.whenStable();
      expect(title()).toBe('Feil — Les gjennom oppskriften');
      expect(text(el.querySelector('#title-error'))).toBe('Tittelen må fylles ut.');
      expect(field(el, 'ingredients').value).toBe(DRAFT.ingredients);
    });

    it('"Bytt bilde" goes back to choosing', async () => {
      const harness = await openReader();
      pick(page(harness)).flush(DRAFT);
      let el = await settle(harness);
      el.querySelector<HTMLButtonElement>('.source-photo button')?.click();
      el = await settle(harness);
      expect(text(el.querySelector('h1'))).toBe('Les oppskrift fra bilde');
      expect(el.querySelector('form')).toBeNull();
      expect(el.querySelector('#source')).not.toBeNull();
    });
  });

  describe('row 10: could not read', () => {
    it('says so, shows the photo and the tips, and offers both ways on', async () => {
      const harness = await openReader();
      pick(page(harness)).flush(UNREADABLE);
      const el = await settle(harness);

      expect(title()).toBe('Fikk ikke lest oppskriften — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Fikk ikke lest oppskriften');
      expect(text(el.querySelector('.unreadable-lead'))).toBe(
        'Teksten på bildet var for utydelig. Ingenting er lagret, så ingen oppskrift er gått tapt.',
      );
      expect(text(el.querySelector('.unreadable-name'))).toBe('oppskrift-kort.jpg');
      await vi.waitFor(() => {
        TestBed.tick();
        expect(text(el.querySelector('.unreadable-meta'))).toBe('2,4 MB · 2048 × 1536');
      });
      expect(text(el.querySelector('.tips h2'))).toBe('Prøv dette');
      expect([...el.querySelectorAll('.tips li')].map(text)).toEqual(TIPS);
      expect(text(el.querySelector('.notice-actions button'))).toBe('Prøv et nytt bilde');
      const manual = el.querySelector('.notice-actions a');
      expect([text(manual), manual?.getAttribute('href')]).toEqual([
        'Skriv den inn selv',
        '/recipes/new',
      ]);
      expect(el.querySelector('form')).toBeNull();
    });

    it('"Prøv et nytt bilde" goes back to choosing', async () => {
      const harness = await openReader();
      pick(page(harness)).flush(UNREADABLE);
      let el = await settle(harness);
      el.querySelector<HTMLButtonElement>('.notice-actions button')?.click();
      el = await settle(harness);
      expect(el.querySelector('#source')).not.toBeNull();
      expect(document.activeElement).toBe(el.querySelector('h1'));
    });
  });

  describe('when the read fails', () => {
    it.each([
      ['too slow (504)', 504, { detail: TIMED_OUT }, TIMED_OUT],
      ['too large for nginx (413)', 413, '<html>413</html>', TOO_LARGE],
      [
        'not a photo (422)',
        422,
        { errors: { photo: 'Filen er ikke et bilde.' } },
        'Filen er ikke et bilde.',
      ],
      ['refused (403)', 403, { detail: 'Forbidden' }, NOT_READ],
    ])('says why under the field: %s', async (_case, status, body, message) => {
      const harness = await openReader();
      const request = pick(page(harness));
      request.flush(body, { status, statusText: 'Error' });
      const el = await settle(harness);
      expect(text(el.querySelector('#source-error'))).toBe(message);
      expect(el.querySelector('#source-error')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('form')).toBeNull();
    });

    it('says so when the request never reached the API', async () => {
      const harness = await openReader();
      pick(page(harness)).error(new ProgressEvent('error'));
      const el = await settle(harness);
      expect(text(el.querySelector('#source-error'))).toBe(NOT_READ);
    });
  });
});
