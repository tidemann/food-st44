import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ApiKey, ApiKeyCreated } from '../api/types';
import {
  EDITOR,
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
import { fill, navigation, submit, submitButton } from '../../testing/form';
import { formatLastUsed } from '../recipes/format';

const KEYS: ApiKey[] = [
  {
    id: 3,
    name: 'Samantha',
    prefix: 'food_sk_7Qd4',
    created_at: '2026-10-08T10:00:00Z',
    last_used_at: '2026-10-09T10:00:00Z',
  },
  {
    id: 1,
    name: 'Claude på PC-en',
    prefix: 'food_sk_Xb27',
    created_at: '2026-10-02T10:00:00Z',
    last_used_at: null,
  },
];
const TOKEN = 'food_sk_7Qd4Rm2TzVx9Kb3Hn6Lp8Wc5Yg1Js0Ae4Uf7Dq';

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

/** Answers GET /api/keys and lets the page render. */
async function keys(harness: RouterTestingHarness, list: ApiKey[]): Promise<HTMLElement> {
  TestBed.tick();
  http().expectOne({ method: 'GET', url: '/api/keys' }).flush(list);
  await harness.fixture.whenStable();
  return page(harness);
}

/** Opens a page that loads the keys, as an editor; `openHarness` would wait for them forever. */
async function openKeys(url: string): Promise<RouterTestingHarness> {
  const harness = await RouterTestingHarness.create();
  signIn(EDITOR);
  await harness.navigateByUrl(url);
  return harness;
}

function crumb(el: HTMLElement): string {
  return text(el.querySelector('.crumb'));
}

describe('Koble til en assistent (ST-833)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  describe('the help page', () => {
    it('gives everyone the address, the Claude app steps and what an assistant may do', async () => {
      const el = await open('/assistent', { me: READER });
      expect(title()).toBe('Koble til en assistent — food.st44.no');
      expect(crumb(el)).toBe('Oppskrifter / Koble til en assistent');
      expect(text(el.querySelector('h1'))).toBe('Koble til en assistent');
      expect(text(el.querySelector('.addr code'))).toBe(`${location.origin}/api/mcp`);
      expect(text(el.querySelector('.addr button'))).toBe('Kopier adressen');
      const headings = [...el.querySelectorAll('.how h2')].map((h) => text(h));
      expect(headings).toEqual(['I Claude-appen']);
      expect(el.querySelectorAll('.how .step')).toHaveLength(4);
      const facts = [...el.querySelectorAll('.facts dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(facts).toEqual([
        ['Søke og lese', 'Alle'],
        ['Legge inn og endre', 'Redaktører'],
        ['Slette', 'Ingen'],
      ]);
      expect(el.querySelector('a[href="/assistent/nokler"]')).toBeNull();
    });

    it('hides the key part from a signed-in reader who is not an editor', async () => {
      const el = await open('/assistent', { me: OUTSIDER });
      expect(el.querySelector('.keys-how')).toBeNull();
    });

    it('shows editors the key steps, with the way to the key page', async () => {
      const el = await open('/assistent', { me: EDITOR });
      const headings = [...el.querySelectorAll('.how h2')].map((h) => text(h));
      expect(headings).toEqual(['I Claude-appen', 'Nøkkel til andre assistenter']);
      expect(text(el.querySelector('.keys-how a[href="/assistent/nokler"]'))).toBe('Nøkler');
    });

    it('copies the address', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const harness = await openHarness('/assistent', { me: READER });
      const button = page(harness).querySelector<HTMLButtonElement>('.addr button');
      button?.click();
      await harness.fixture.whenStable();
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/api/mcp`);
      expect(text(button)).toBe('Kopiert');
    });
  });

  describe('the key page', () => {
    it('lists the keys newest first, with prefix, dates and «Slett»', async () => {
      const el = await keys(await openKeys('/assistent/nokler'), KEYS);
      expect(title()).toBe('Nøkler — food.st44.no');
      expect(crumb(el)).toBe('Oppskrifter / Koble til en assistent / Nøkler');
      expect(text(el.querySelector('.keyhead h2'))).toBe('2 nøkler · nyeste først');
      expect(el.querySelector('.keyhead a')?.getAttribute('href')).toBe('/assistent/nokler/ny');
      const rows = [...el.querySelectorAll('.key')];
      expect(rows.map((row) => text(row.querySelector('h3')))).toEqual([
        'Samantha',
        'Claude på PC-en',
      ]);
      expect(text(rows[0]?.querySelector('.m'))).toBe('food_sk_7Qd4… · Laget 8. oktober 2026');
      expect(text(rows[0]?.querySelectorAll('.m')[1])).toBe('Sist brukt 9. oktober 2026');
      expect(text(rows[1]?.querySelectorAll('.m')[1])).toBe('Aldri brukt');
      const remove = rows[0]?.querySelector('a.btn-danger-ghost');
      expect([text(remove), remove?.getAttribute('href')]).toEqual([
        'Slett',
        '/assistent/nokler/3/slett',
      ]);
    });

    it('says «1 nøkkel», not «1 nøkler»', async () => {
      const first = KEYS[0];
      if (!first) throw new Error('no key');
      const el = await keys(await openKeys('/assistent/nokler'), [first]);
      expect(text(el.querySelector('.keyhead h2'))).toBe('1 nøkkel · nyeste først');
    });

    it('has its own empty state', async () => {
      const el = await keys(await openKeys('/assistent/nokler'), []);
      expect(text(el.querySelector('.keyhead h2'))).toBe('Ingen nøkler ennå');
      expect(el.querySelector('.keys')).toBeNull();
      expect(text(el.querySelector('.note'))).toContain('Claude-appen trenger ingen nøkkel');
    });

    it('is «Ingen tilgang» for a reader who is not an editor, and asks nothing of the API', async () => {
      const el = await open('/assistent/nokler', { me: OUTSIDER });
      expect(text(el.querySelector('h1'))).toBe('Ingen tilgang');
      http().expectNone('/api/keys');
    });

    it('asks a reader who is not signed in to sign in', async () => {
      const el = await open('/assistent/nokler/ny', { me: READER });
      expect(text(el.querySelector('h1'))).toBe('Logg inn for å endre');
    });
  });

  describe('a new key', () => {
    it('is named, made, and shown once with the warning above it', async () => {
      const harness = await openHarness('/assistent/nokler/ny');
      let el = page(harness);
      expect(title()).toBe('Ny nøkkel — food.st44.no');
      expect(crumb(el)).toBe('Oppskrifter / Koble til en assistent / Nøkler / Ny nøkkel');
      expect(el.querySelector('#key-name')?.getAttribute('maxlength')).toBe('40');

      fill(el, 'key-name', '  Samantha ');
      const request = submit(el, 'POST', '/api/keys');
      expect(request.request.body).toEqual({ name: 'Samantha' });
      const made: ApiKeyCreated = { ...KEYS[0], token: TOKEN } as ApiKeyCreated;
      request.flush(made, { status: 201, statusText: 'Created' });
      await harness.fixture.whenStable();

      el = page(harness);
      expect(title()).toBe('Nøkkelen «Samantha» er laget — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Nøkkelen «Samantha» er laget');
      const warning = el.querySelector('.alert[role="status"]');
      expect(text(warning?.querySelector('.alert-title'))).toBe('Kopier nøkkelen nå');
      expect(text(el.querySelector('.token code'))).toBe(TOKEN);
      // The warning comes before the key: read one line, read that one.
      const token = el.querySelector('.token');
      expect(token && warning?.compareDocumentPosition(token)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(text(el.querySelector('.how'))).toContain(`${location.origin}/api/mcp`);
      expect(el.querySelector('.page-actions a')?.getAttribute('href')).toBe('/assistent/nokler');
    });

    it('is gone when the page is opened again', async () => {
      const harness = await openHarness('/assistent/nokler/ny');
      fill(page(harness), 'key-name', 'Samantha');
      submit(page(harness), 'POST', '/api/keys').flush({ ...KEYS[0], token: TOKEN });
      await harness.fixture.whenStable();
      expect(page(harness).textContent).toContain(TOKEN);

      await harness.navigateByUrl('/assistent');
      await harness.navigateByUrl('/assistent/nokler/ny');
      const el = page(harness);
      expect(el.textContent).not.toContain(TOKEN);
      expect(text(el.querySelector('h1'))).toBe('Ny nøkkel');
    });

    it('needs a name, and shows the API’s message for one it refuses', async () => {
      const harness = await openHarness('/assistent/nokler/ny');
      const el = page(harness);
      submitButton(el).click();
      await harness.fixture.whenStable();
      http().expectNone('/api/keys');
      expect(text(el.querySelector('.field-error'))).toBe('Gi nøkkelen et navn.');
      expect(el.querySelector('#key-name')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement?.id).toBe('key-name');

      fill(el, 'key-name', 'Samantha');
      submit(el, 'POST', '/api/keys').flush(
        { errors: { name: 'Navnet kan være høyst 40 tegn.' } },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await harness.fixture.whenStable();
      expect(text(el.querySelector('.field-error'))).toBe('Navnet kan være høyst 40 tegn.');
    });
  });

  describe('deleting a key', () => {
    it('asks first, «Avbryt» before the red button', async () => {
      const el = await keys(await openKeys('/assistent/nokler/3/slett'), KEYS);
      expect(title()).toBe('Slett nøkkelen «Samantha»? — food.st44.no');
      expect(text(el.querySelector('h1'))).toBe('Slett nøkkelen «Samantha»?');
      const actions = [...el.querySelectorAll('.notice-actions > *')].map((a) => text(a));
      expect(actions).toEqual(['Avbryt', 'Slett nøkkelen']);
      expect(submitButton(el).classList).toContain('btn-danger');
    });

    it('sends one DELETE and goes back to the list', async () => {
      const harness = await openKeys('/assistent/nokler/3/slett');
      const el = await keys(harness, KEYS);
      const request = submit(el, 'DELETE', '/api/keys/3');
      const navigated = navigation();
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect((await navigated).url).toBe('/assistent/nokler');
      await keys(harness, KEYS.slice(1));
    });

    it('is «Siden finnes ikke» for a key that is not there', async () => {
      const el = await keys(await openKeys('/assistent/nokler/99/slett'), KEYS);
      expect(text(el.querySelector('h1'))).toBe('Siden finnes ikke');
    });
  });
});

describe('formatLastUsed', () => {
  it('says «i dag kl.» for today, in Oslo time', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(formatLastUsed('2026-10-11T07:14:00Z', now)).toBe('i dag kl. 09.14');
    expect(formatLastUsed('2026-10-09T07:14:00Z', now)).toBe('9. oktober 2026');
  });
});
