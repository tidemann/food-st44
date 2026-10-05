import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Recipe } from '../api/types';
import {
  answer,
  open,
  openHarness,
  page,
  READER,
  seed,
  setUp,
  text,
  title,
} from '../../testing/app';
import {
  choose,
  fill,
  navigation,
  photoFile,
  reject,
  submit,
  submitButton,
} from '../../testing/form';
import { formatSize, NOT_AN_IMAGE, photoProblem, TOO_LARGE } from './photo';

const PHOTO_URL = '/photos/10-abc.webp';
const SERVER_NOT_AN_IMAGE = 'Filen er ikke et bilde. Velg et JPEG-, PNG- eller WEBP-bilde.';

const lapskaus: Recipe = {
  id: 10,
  title: 'Lapskaus',
  ingredients: '500 g storfekjøtt',
  instructions: '',
  created_at: '2026-10-04T10:00:00Z',
  photo_url: null,
};
const withPhoto = (recipe: Recipe, photo_url: string | null = PHOTO_URL): Recipe => ({
  ...recipe,
  photo_url,
});

function buttons(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.photo button')].map(text);
}

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

describe('photo rules', () => {
  it('takes JPEG, PNG and WebP up to 25 MB, so a 10 MB+ phone photo gets through', () => {
    expect(photoProblem(photoFile('a.jpg', 'image/jpeg', 12 * 2 ** 20))).toBeNull();
    expect(photoProblem(photoFile('a.png', 'image/png'))).toBeNull();
    expect(photoProblem(photoFile('a.webp', 'image/webp', 25 * 2 ** 20))).toBeNull();
    expect(photoProblem(photoFile('a.jpg', 'image/jpeg', 25 * 2 ** 20 + 1))).toBe(TOO_LARGE);
    expect(photoProblem(photoFile('a.pdf', 'application/pdf'))).toBe(NOT_AN_IMAGE);
    expect(photoProblem(photoFile('a.heic', 'image/heic'))).toBe(NOT_AN_IMAGE);
    expect(photoProblem(photoFile('a', ''))).toBe(NOT_AN_IMAGE);
  });

  it('writes sizes the Norwegian way', () => {
    expect(formatSize(2.4 * 2 ** 20)).toBe('2,4 MB');
    expect(formatSize(310 * 1024)).toBe('310 kB');
    expect(formatSize(26 * 2 ** 20)).toBe('26 MB');
  });
});

describe('the photo field', () => {
  beforeEach(() => {
    setUp();
    // jsdom decodes no images: hand back a bitmap the size of a phone photo, and no canvas.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 3024, height: 4032, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    http().verify();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('empty (design row 4)', () => {
    it('offers "Ta bilde" and "Velg bilde" with the types and the limit', async () => {
      const el = await open('/recipes/new');
      expect(text(el.querySelector('.photo legend'))).toBe('Bilde (valgfritt)');
      expect(text(el.querySelector('#photo-hint'))).toBe(
        'Ett bilde av den ferdige retten. JPEG, PNG eller WEBP, høyst 25 MB.',
      );
      expect(buttons(el)).toEqual(['Ta bilde', 'Velg bilde']);
      expect(text(el.querySelector('.photo-drop'))).toBe('… eller slipp bildefilen her.');

      const camera = el.querySelector('#photo-camera');
      expect(camera?.getAttribute('capture')).toBe('environment');
      for (const input of [el.querySelector('#photo'), camera]) {
        expect(input?.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
      }
      expect(el.querySelector('.photo-error, .field-error')).toBeNull();
    });

    it.each(['/recipes/new', '/recipes/9/edit'])(
      'is not on %s for someone who is not an editor',
      async (url) => {
        const el = await open(url, { me: READER });
        expect(el.querySelector('form')).toBeNull();
        expect(el.querySelector('.photo, input[type="file"]')).toBeNull();
      },
    );
  });

  describe('chosen (design row 5)', () => {
    it('shows the preview, the name and size, and sends nothing before "Lagre"', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      choose(el, photoFile('kjottkaker.jpg', 'image/jpeg'));
      await harness.fixture.whenStable();

      expect(el.querySelector('canvas.photo-preview')?.getAttribute('aria-label')).toBe(
        'Valgt bilde',
      );
      expect(text(el.querySelector('.photo-name'))).toBe('kjottkaker.jpg');
      // The pixels come once the file is decoded.
      await vi.waitFor(() => {
        TestBed.tick();
        expect(text(el.querySelector('.photo-meta'))).toBe('2,4 MB · 3024 × 4032');
      });
      expect(buttons(el)).toEqual(['Bytt bilde', 'Fjern bilde']);
      http().expectNone(() => true);
    });

    it('takes a photo from the camera input too', async () => {
      const el = await open('/recipes/new');
      choose(el, photoFile('IMG_0001.jpg', 'image/jpeg', 12 * 2 ** 20), 'photo-camera');
      expect(text(el.querySelector('.photo-name'))).toBe('IMG_0001.jpg');
      expect(text(el.querySelector('.photo-meta'))).toContain('12 MB');
    });

    it('takes a file dropped on the field', async () => {
      const el = await open('/recipes/new');
      const drop = new Event('drop', { cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: { files: [photoFile('fra-pc.png', 'image/png')] },
      });
      el.querySelector('.photo-empty')?.dispatchEvent(drop);
      TestBed.tick();
      expect(drop.defaultPrevented).toBe(true);
      expect(text(el.querySelector('.photo-name'))).toBe('fra-pc.png');
    });

    it('"Fjern bilde" empties the field again', async () => {
      const el = await open('/recipes/new');
      choose(el, photoFile('kjottkaker.jpg', 'image/jpeg'));
      el.querySelector<HTMLButtonElement>('.photo .btn-danger-ghost')?.click();
      TestBed.tick();
      expect(buttons(el)).toEqual(['Ta bilde', 'Velg bilde']);
      expect(el.querySelector('.photo-note')).toBeNull();
    });
  });

  describe('refused (design row 6)', () => {
    it('refuses a file that is not an image, and "Lagre" sends nothing', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      choose(el, photoFile('oppskrift.pdf', 'application/pdf', 310 * 1024));

      expect(text(el.querySelector('.photo-rejected'))).toBe('Avvist: oppskrift.pdf — 310 kB');
      expect(text(el.querySelector('#photo-error'))).toBe(NOT_AN_IMAGE);
      expect(el.querySelector('.photo')?.classList).toContain('field-invalid');
      expect(buttons(el)).toEqual(['Ta bilde', 'Velg bilde']);

      fill(el, 'title', 'Kjøttkaker');
      submitButton(el).click();
      TestBed.tick();
      await harness.fixture.whenStable();
      http().expectNone(() => true);
      const summary = el.querySelector('.alert');
      expect(text(summary?.querySelector('.alert-title'))).toBe('Oppskriften ble ikke lagret');
      expect(text(summary?.querySelector('a'))).toBe(NOT_AN_IMAGE);
      expect(document.activeElement).toBe(summary);
      expect(title()).toBe('Ny oppskrift — food.st44.no');

      // The summary's link lands on "Velg bilde".
      summary?.querySelector('a')?.click();
      expect(text(document.activeElement)).toBe('Velg bilde');
    });

    it('refuses a photo over 25 MB', async () => {
      const el = await open('/recipes/new');
      choose(el, photoFile('middag.jpg', 'image/jpeg', 26 * 2 ** 20));
      expect(text(el.querySelector('.photo-rejected'))).toBe('Avvist: middag.jpg — 26 MB');
      expect(text(el.querySelector('#photo-error'))).toBe(
        'Bildet er for stort. Velg et bilde under 25 MB.',
      );
    });

    it('lets the next good file replace the refused one', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      choose(el, photoFile('oppskrift.pdf', 'application/pdf'));
      submitButton(el).click();
      TestBed.tick();
      await harness.fixture.whenStable();
      expect(el.querySelector('.alert')).not.toBeNull();

      el.querySelector<HTMLInputElement>('#title')?.focus();
      choose(el, photoFile('kjottkaker.jpg', 'image/jpeg'));
      await harness.fixture.whenStable();
      // The summary drops the answered error, and focus stays where the user is.
      expect(el.querySelector('.alert')).toBeNull();
      expect(document.activeElement?.id).toBe('title');
      expect(el.querySelector('.photo-rejected')).toBeNull();
      expect(el.querySelector('#photo-error')).toBeNull();
      expect(text(el.querySelector('.photo-name'))).toBe('kjottkaker.jpg');
    });
  });

  describe('saving a new recipe', () => {
    it('sends the recipe, then the photo, and goes to the recipe', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      fill(el, 'title', 'Lapskaus');
      fill(el, 'ingredients', '500 g storfekjøtt');
      const file = photoFile('lapskaus.jpg', 'image/jpeg');
      choose(el, file);

      const navigated = navigation();
      submit(el, 'POST', '/api/recipes').flush(lapskaus, { status: 201, statusText: 'Created' });
      const upload = http().expectOne({ method: 'POST', url: '/api/recipes/10/photo' });
      const body = upload.request.body as FormData;
      expect(body.get('photo')).toBe(file);
      upload.flush(withPhoto(lapskaus));
      expect((await navigated).url).toBe('/recipes/10?flash=created');

      answer({ recipe: withPhoto(lapskaus) });
      await harness.fixture.whenStable();
      expect(page(harness).querySelector('.rhero img')?.getAttribute('src')).toBe(PHOTO_URL);
    });

    it('sends no photo request when none was chosen', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      const navigated = navigation();
      submit(el, 'POST', '/api/recipes').flush(lapskaus, { status: 201, statusText: 'Created' });
      http().expectNone({ url: '/api/recipes/10/photo' });
      await navigated;
      answer({ recipe: lapskaus });
    });

    it('shows a photo the API refuses, then updates the saved recipe instead of adding it twice', async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      fill(el, 'title', 'Lapskaus');
      choose(el, photoFile('forkledd.jpg', 'image/jpeg'));
      submit(el, 'POST', '/api/recipes').flush(lapskaus, { status: 201, statusText: 'Created' });
      reject(http().expectOne({ method: 'POST', url: '/api/recipes/10/photo' }), {
        photo: SERVER_NOT_AN_IMAGE,
      });
      answer({});
      await harness.fixture.whenStable();

      expect(title()).toBe('Feil — Ny oppskrift');
      expect(text(el.querySelector('.alert-title'))).toBe('Oppskriften er lagret, men ikke bildet');
      expect(text(el.querySelector('.alert a'))).toBe(SERVER_NOT_AN_IMAGE);
      expect(text(el.querySelector('#photo-error'))).toBe(SERVER_NOT_AN_IMAGE);

      const good = photoFile('lapskaus.jpg', 'image/jpeg');
      choose(el, good);
      expect(el.querySelector('#photo-error')).toBeNull();
      const navigated = navigation();
      submit(el, 'PUT', '/api/recipes/10').flush(lapskaus);
      const upload = http().expectOne({ method: 'POST', url: '/api/recipes/10/photo' });
      expect((upload.request.body as FormData).get('photo')).toBe(good);
      upload.flush(withPhoto(lapskaus));
      await navigated;
      answer({ recipe: withPhoto(lapskaus) });
    });

    it("shows nginx's 413, which has no field error, as too large", async () => {
      const harness = await openHarness('/recipes/new');
      const el = page(harness);
      choose(el, photoFile('stor.jpg', 'image/jpeg', 20 * 2 ** 20));
      submit(el, 'POST', '/api/recipes').flush(lapskaus, { status: 201, statusText: 'Created' });
      http()
        .expectOne({ method: 'POST', url: '/api/recipes/10/photo' })
        .flush('<html>413 Request Entity Too Large</html>', {
          status: 413,
          statusText: 'Request Entity Too Large',
        });
      answer({});
      await harness.fixture.whenStable();
      expect(text(el.querySelector('#photo-error'))).toBe(TOO_LARGE);
    });
  });

  describe('editing', () => {
    const kjottkaker = withPhoto(seed(9), '/photos/9-old.webp');

    it('shows the stored photo with "Bytt bilde" and "Fjern bilde"', async () => {
      const el = await open('/recipes/9/edit', { recipe: kjottkaker });
      expect(el.querySelector('.photo-preview img')?.getAttribute('src')).toBe(
        '/photos/9-old.webp',
      );
      expect(text(el.querySelector('.photo-name'))).toBe('Bildet på oppskriften');
      expect(buttons(el)).toEqual(['Bytt bilde', 'Fjern bilde']);
    });

    it('keeps the photo when only the text changes', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      const el = page(harness);
      const navigated = navigation();
      submit(el, 'PUT', '/api/recipes/9').flush(kjottkaker);
      http().expectNone({ url: '/api/recipes/9/photo' });
      await navigated;
      answer({ recipe: kjottkaker });
    });

    it('replaces the photo', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      const el = page(harness);
      const file = photoFile('ny.webp', 'image/webp');
      choose(el, file);
      const navigated = navigation();
      submit(el, 'PUT', '/api/recipes/9').flush(kjottkaker);
      const upload = http().expectOne({ method: 'POST', url: '/api/recipes/9/photo' });
      expect((upload.request.body as FormData).get('photo')).toBe(file);
      upload.flush(withPhoto(kjottkaker, '/photos/9-new.webp'));
      expect((await navigated).url).toBe('/recipes/9?flash=updated');
      answer({ recipe: withPhoto(kjottkaker, '/photos/9-new.webp') });
    });

    it('removes the photo on save, not before', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      const el = page(harness);
      el.querySelector<HTMLButtonElement>('.photo .btn-danger-ghost')?.click();
      TestBed.tick();
      expect(buttons(el)).toEqual(['Ta bilde', 'Velg bilde']);
      expect(text(el.querySelector('.photo-note'))).toBe(
        'Bildet fjernes når du lagrer oppskriften.',
      );
      http().expectNone(() => true);

      const navigated = navigation();
      submit(el, 'PUT', '/api/recipes/9').flush(kjottkaker);
      http()
        .expectOne({ method: 'DELETE', url: '/api/recipes/9/photo' })
        .flush(withPhoto(kjottkaker, null));
      await navigated;
      answer({ recipe: seed(9) });
    });

    it('says the text was saved when only the photo was refused', async () => {
      const harness = await openHarness('/recipes/9/edit', { recipe: kjottkaker });
      const el = page(harness);
      choose(el, photoFile('forkledd.png', 'image/png'));
      submit(el, 'PUT', '/api/recipes/9').flush(kjottkaker);
      reject(http().expectOne({ method: 'POST', url: '/api/recipes/9/photo' }), {
        photo: SERVER_NOT_AN_IMAGE,
      });
      answer({});
      await harness.fixture.whenStable();
      expect(title()).toBe('Feil — Rediger oppskrift');
      expect(text(el.querySelector('.alert-title'))).toBe('Oppskriften er lagret, men ikke bildet');
      expect(text(el.querySelector('#photo-error'))).toBe(SERVER_NOT_AN_IMAGE);
    });
  });
});

describe('photos on the read pages', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  it('shows the photo above the recipe, and none when it has none', async () => {
    let el = await open('/recipes/9', { recipe: withPhoto(seed(9), '/photos/9.webp') });
    const img = el.querySelector('.rhero img');
    expect(img?.getAttribute('src')).toBe('/photos/9.webp');
    expect(img?.getAttribute('alt')).toBe('Kjøttkaker i brun saus');

    TestBed.resetTestingModule();
    setUp();
    el = await open('/recipes/8', { recipe: seed(8) });
    expect(el.querySelector('.rhero')).toBeNull();
  });

  it('shows photos in the list where the recipe has one, and the plate where not', async () => {
    const all = [withPhoto(seed(9), '/photos/9.webp'), seed(8), seed(7), seed(6), seed(5)];
    all[4] = withPhoto(seed(5), '/photos/5.webp');
    const el = await open('/', { all });
    expect(el.querySelector('.lead-fig img')?.getAttribute('src')).toBe('/photos/9.webp');
    expect(el.querySelectorAll('.sideitem .plate')).toHaveLength(3);
    expect(el.querySelector('.card img')?.getAttribute('src')).toBe('/photos/5.webp');
  });

  it('shows photos in the search hits', async () => {
    const el = await open('/?q=saus', {
      search: [withPhoto(seed(9), '/photos/9.webp'), seed(8)],
    });
    const hits = el.querySelectorAll('.hits li');
    expect(hits[0]?.querySelector('img')?.getAttribute('src')).toBe('/photos/9.webp');
    expect(hits[1]?.querySelector('.plate')).not.toBeNull();
  });
});
