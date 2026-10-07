import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Recipe } from '../api/types';
import {
  answer,
  open,
  openHarness,
  page,
  seed,
  setUp,
  signIn,
  text,
  title,
} from '../../testing/app';
import { navigation } from '../../testing/form';
import { Site } from '../site';

const kjottkaker: Recipe = {
  ...seed(9),
  ingredients: '600 g kjøttdeig av storfe\n1 ts salt\n2 dl melk\nsalt og pepper',
  instructions: [
    'Bland kjøttdeig og salt.',
    'Rør inn melken litt og litt.',
    'Brun kakene i smør, ca. 10 minutter, til de er gylne.',
    'La dem trekke i sausen i 20–25 min.',
  ].join('\n\n'),
};

async function cook(
  url: string,
  recipe: Recipe | number = kjottkaker,
): Promise<RouterTestingHarness> {
  return openHarness(url, { recipe });
}

async function click(harness: RouterTestingHarness, selector: string): Promise<HTMLElement> {
  const button = page(harness).querySelector<HTMLElement>(selector);
  if (!button) throw new Error(`no ${selector}`);
  button.click();
  await harness.fixture.whenStable();
  return page(harness);
}

function url(): string {
  return TestBed.inject(Router).url;
}

describe('RecipeCook', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setUp();
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(HttpTestingController).verify();
  });

  it('opens on the first step, without the masthead', async () => {
    const harness = await cook('/recipes/9/cook');
    const el = page(harness);
    expect(text(el.querySelector('h1'))).toBe('Kjøttkaker i brun saus');
    expect(text(el.querySelector('.count'))).toBe('Steg 1 av 4');
    expect(text(el.querySelector('.n'))).toBe('1');
    expect(text(el.querySelector('.text'))).toBe('Bland kjøttdeig og salt.');
    expect(el.querySelector('.exit')?.getAttribute('href')).toBe('/recipes/9');
    expect(el.querySelector<HTMLButtonElement>('.prev')?.disabled).toBe(true);
    expect(title()).toBe('Matlaging: Kjøttkaker i brun saus — food.st44.no');
    expect(TestBed.inject(Site).cooking()).toBe(true);
  });

  it('keeps the step in the address, and reads it back', async () => {
    const harness = await cook('/recipes/9/cook?steg=3');
    let el = page(harness);
    expect(text(el.querySelector('.count'))).toBe('Steg 3 av 4');
    el = await click(harness, '.next');
    expect(url()).toBe('/recipes/9/cook?steg=4');
    expect(text(el.querySelector('.count'))).toBe('Steg 4 av 4');
    await click(harness, '.prev');
    expect(url()).toBe('/recipes/9/cook?steg=3');
  });

  it('turns a step out of range into the nearest step', async () => {
    const el = page(await cook('/recipes/9/cook?steg=40'));
    expect(text(el.querySelector('.count'))).toBe('Steg 4 av 4');
  });

  it('ends on "Ferdig", back to the recipe', async () => {
    const el = page(await cook('/recipes/9/cook?steg=4'));
    const done = el.querySelector('.next');
    expect(text(done)).toBe('Ferdig');
    expect(done?.getAttribute('href')).toBe('/recipes/9');
  });

  it('moves with the arrow keys, but not while typing', async () => {
    const harness = await cook('/recipes/9/cook?steg=2');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await harness.fixture.whenStable();
    expect(url()).toBe('/recipes/9/cook?steg=3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await harness.fixture.whenStable();
    expect(url()).toBe('/recipes/9/cook?steg=2');

    const el = await click(harness, '.timing .link');
    const field = el.querySelector('input[type=number]');
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await harness.fixture.whenStable();
    expect(url()).toBe('/recipes/9/cook?steg=2');
  });

  it('marks the time in the step and offers a timer for it', async () => {
    const el = page(await cook('/recipes/9/cook?steg=3'));
    expect(text(el.querySelector('mark'))).toBe('ca. 10 minutter');
    // No space between the time and the comma after it, so the line cannot break there.
    expect(el.querySelector('.text')?.textContent).toBe(
      'Brun kakene i smør, ca. 10 minutter, til de er gylne.',
    );
    expect(el.querySelectorAll('.start')).toHaveLength(1);
    expect(text(el.querySelector('.start-label'))).toBe('Start timer');
    expect(text(el.querySelector('.start-time'))).toBe('10:00');
  });

  it('times "20–25 min" by the upper bound', async () => {
    const el = page(await cook('/recipes/9/cook?steg=4'));
    expect(text(el.querySelector('.start-time'))).toBe('25:00');
  });

  it('runs a timer on every step, and says when the time is up', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const harness = await cook('/recipes/9/cook?steg=3');
    let el = await click(harness, '.start');
    expect(text(el.querySelector('.timer-clock'))).toBe('10:00');
    expect(text(el.querySelector('.timer-label'))).toBe('Steg 3');

    el = await click(harness, '.next');
    vi.advanceTimersByTime(126_000);
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.timer-clock'))).toBe('07:54');

    vi.advanceTimersByTime(600_000);
    await harness.fixture.whenStable();
    expect(el.querySelector('.timer')).toBeNull();
    expect(text(el.querySelector('.done h2'))).toBe('Tiden er ute');
    expect(text(el.querySelector('.done p'))).toBe('Steg 3 — 10 minutter er gått.');

    el = await click(harness, '.done .btn:not(.btn-primary)');
    expect(el.querySelector('.done')).toBeNull();
    expect(text(el.querySelector('.timer-clock'))).toBe('01:00');
  });

  it('starts a timer with a time you set', async () => {
    const harness = await cook('/recipes/9/cook?steg=1');
    let el = await click(harness, '.timing .link');
    const field = el.querySelector<HTMLInputElement>('#own-minutes');
    expect(field?.value).toBe('5');
    if (field) field.value = '3';
    el = await click(harness, '.own .btn-primary');
    expect(text(el.querySelector('.timer-clock'))).toBe('03:00');
    expect(text(el.querySelector('.timer-label'))).toBe('Steg 1 · egen tid');
  });

  it('ticks off ingredients and remembers them until "Avslutt"', async () => {
    const harness = await cook('/recipes/9/cook');
    let el = await click(harness, '.ing-open');
    expect(el.querySelector('.ing')?.getAttribute('role')).toBe('dialog');
    expect(text(el.querySelector('.ing-count'))).toBe('0 av 4 krysset av');
    el.querySelectorAll<HTMLInputElement>('.ing input')[2]?.click();
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.ing-count'))).toBe('1 av 4 krysset av');
    expect(sessionStorage.getItem('food.cook.9.ticks')).toBe('[2]');

    el = await click(harness, '.ing-close');
    expect(el.querySelector('.ing')?.getAttribute('role')).toBeNull();

    const navigated = navigation();
    page(harness).querySelector<HTMLElement>('.exit')?.click();
    expect((await navigated).url).toBe('/recipes/9');
    answer({ recipe: kjottkaker });
    await harness.fixture.whenStable();
    expect(sessionStorage.getItem('food.cook.9.ticks')).toBeNull();
    expect(TestBed.inject(Site).cooking()).toBe(false);
  });

  it('reads the ticks back after a reload', async () => {
    sessionStorage.setItem('food.cook.9.ticks', '[0,3]');
    const el = page(await cook('/recipes/9/cook'));
    expect(
      [...el.querySelectorAll<HTMLInputElement>('.ing input')].map((input) => input.checked),
    ).toEqual([true, false, false, true]);
  });

  it('sends a recipe with no steps back to its page', async () => {
    const harness = await RouterTestingHarness.create();
    signIn();
    await harness.navigateByUrl('/recipes/7/cook');
    const navigated = navigation();
    answer({ recipe: seed(7) });
    expect((await navigated).url).toBe('/recipes/7');
    answer({ recipe: seed(7) });
    await harness.fixture.whenStable();
    expect(text(page(harness).querySelector('h1'))).toBe(seed(7).title);
  });

  it('shows "Fant ikke oppskriften" inside the site for an unknown recipe', async () => {
    const el = page(await cook('/recipes/999/cook', 404));
    expect(text(el.querySelector('h1'))).toBe('Fant ikke oppskriften');
    expect(TestBed.inject(Site).cooking()).toBe(false);
  });
});

describe('RecipeDetail: Start matlaging', () => {
  beforeEach(() => {
    setUp();
  });

  it('opens cooking mode from a recipe with steps', async () => {
    const el = await open('/recipes/9', { recipe: seed(9) });
    const start = el.querySelector('.cook-start a');
    expect(text(start)).toBe('Start matlaging');
    expect(start?.getAttribute('href')).toBe('/recipes/9/cook');
  });

  it('is not there when the recipe has no steps', async () => {
    const el = await open('/recipes/7', { recipe: seed(7) });
    expect(el.querySelector('.cook-start')).toBeNull();
  });
});
