import { HttpXsrfTokenExtractor } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ApiError, OAuthApproval } from '../api/types';
import { EDITOR, OUTSIDER, page, setUp, signIn, text, title } from '../../testing/app';

/** The app's authorization request, as food/oauth.py forwards it to the page. */
const QUERY =
  'response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback' +
  '&code_challenge=xyz&code_challenge_method=S256&state=s1' +
  '&resource=https%3A%2F%2Ffood.st44.no%2Fapi%2Fmcp';

const FIELDS = {
  client_id: 'abc',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  response_type: 'code',
  state: 's1',
  code_challenge: 'xyz',
  code_challenge_method: 'S256',
  scope: 'read write',
  resource: 'https://food.st44.no/api/mcp',
};

const AS_EDITOR: OAuthApproval = {
  client_name: 'Claude',
  client_host: 'claude.ai',
  name: 'Åse Berg',
  email: 'ase.berg@example.no',
  initial: 'Å',
  can_write: true,
  fields: FIELDS,
};
const AS_READER: OAuthApproval = {
  ...AS_EDITOR,
  can_write: false,
  fields: { ...FIELDS, scope: 'read' },
};

function http(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

/** Opens the page and answers GET /api/oauth/approval with `body`, or an error status. */
async function approve(body: OAuthApproval | number, detail = ''): Promise<HTMLElement> {
  TestBed.overrideProvider(HttpXsrfTokenExtractor, { useValue: { getToken: () => 'csrf-1' } });
  const harness = await RouterTestingHarness.create();
  signIn(typeof body === 'number' ? OUTSIDER : EDITOR);
  await harness.navigateByUrl(`/assistent/godkjenn?${QUERY}`);
  TestBed.tick();
  const request = http().expectOne({ method: 'GET', url: `/api/oauth/approval?${QUERY}` });
  if (typeof body === 'number') {
    const error: ApiError = { detail };
    request.flush(error, { status: body, statusText: 'Error' });
  } else {
    request.flush(body);
  }
  await harness.fixture.whenStable();
  return page(harness);
}

function facts(el: HTMLElement): string[][] {
  return [...el.querySelectorAll('.facts dl > div')].map((row) => [
    text(row.querySelector('dt')),
    text(row.querySelector('dd')),
  ]);
}

function hidden(el: HTMLElement): Record<string, string> {
  const inputs = el.querySelectorAll<HTMLInputElement>('form input[type="hidden"]');
  return Object.fromEntries([...inputs].map((input) => [input.name, input.value]));
}

describe('Claude ber om tilgang (ST-834)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    http().verify();
  });

  it('asks an editor to let Claude read and write, as them', async () => {
    const el = await approve(AS_EDITOR);
    expect(title()).toBe('Claude ber om tilgang — food.st44.no');
    expect(text(el.querySelector('.crumb'))).toBe('Claude ber om tilgang');
    expect(text(el.querySelector('h1'))).toBe('Claude vil lese og endre oppskrifter som deg');
    expect(text(el.querySelector('.lead'))).toBe(
      'Sier du ja, kan Claude søke i samlingen, lese oppskrifter og legge inn eller rette dem i ditt navn.',
    );
    expect(text(el.querySelector('.who-card .initial'))).toBe('Å');
    expect(text(el.querySelector('.who-card b'))).toBe('Åse Berg');
    expect(text(el.querySelector('.who-mail'))).toBe('ase.berg@example.no');
    expect(text(el.querySelector('.facts h2'))).toBe('Dette sier du ja til');
    expect(facts(el)).toEqual([
      ['Søke og lese oppskrifter', 'Ja'],
      ['Legge inn og endre', 'Ja'],
      ['Slette oppskrifter', 'Nei'],
    ]);
    expect(text(el.querySelector('.note'))).toContain('Svaret sendes til claude.ai.');
  });

  it('tells someone not on the editor list that Claude can only read', async () => {
    const el = await approve(AS_READER);
    expect(text(el.querySelector('h1'))).toBe('Claude vil lese oppskrifter som deg');
    expect(text(el.querySelector('.lead'))).toContain(
      'Kontoen din er ikke redaktør, så Claude kan ikke endre noe.',
    );
    expect(facts(el)[1]).toEqual(['Legge inn og endre', 'Nei']);
  });

  it('posts the request back to the authorization endpoint, with the CSRF token', async () => {
    const el = await approve(AS_EDITOR);
    const form = el.querySelector('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/api/oauth/authorize/');
    expect(hidden(el)).toEqual({ csrfmiddlewaretoken: 'csrf-1', ...FIELDS });
  });

  it('puts «Avvis» first and «Tillat» last; only «Tillat» sends allow', async () => {
    const el = await approve(AS_EDITOR);
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('form button')];
    expect(buttons.map((button) => text(button))).toEqual(['Avvis', 'Tillat']);
    expect(buttons.map((button) => button.type)).toEqual(['submit', 'submit']);
    expect(buttons[0]?.name).toBe('');
    expect([buttons[1]?.name, buttons[1]?.value]).toEqual(['allow', 'on']);
    expect(buttons[1]?.classList).toContain('btn-primary');
  });

  it('offers the sign-in again to someone signed out in between', async () => {
    const el = await approve(401, 'Du er ikke logget inn.');
    expect(text(el.querySelector('h1'))).toBe('Logg inn først');
    expect(text(el.querySelector('.notice p'))).toBe('Du er ikke logget inn.');
    const link = el.querySelector('.notice-actions a');
    expect(text(link)).toBe('Logg inn med Google');
    expect(link?.getAttribute('href')).toBe(`/api/oauth/authorize/?${QUERY}`);
    expect(el.querySelector('form')).toBeNull();
  });

  it('says so when the link from the app does not work', async () => {
    const el = await approve(400, 'Lenken fra appen virker ikke.');
    expect(text(el.querySelector('h1'))).toBe('Lenken virker ikke');
    expect(text(el.querySelector('.notice p'))).toBe('Lenken fra appen virker ikke.');
    expect(el.querySelector('.notice-actions')).toBeNull();
    expect(el.querySelector('form')).toBeNull();
  });

  it('shows the server error page for anything else', async () => {
    const el = await approve(500);
    expect(el.querySelector('app-server-error')).not.toBeNull();
    expect(el.querySelector('form')).toBeNull();
  });
});
