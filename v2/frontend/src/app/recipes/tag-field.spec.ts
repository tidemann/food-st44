import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { openHarness, page, setUp, text } from '../../testing/app';
import { field, fill, submit } from '../../testing/form';

/** The tag input on S-NEW, which every way to add a recipe ends in. */
async function form(): Promise<HTMLElement> {
  return page(await openHarness('/recipes/new'));
}

function key(el: HTMLElement, name: string): boolean {
  const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
  field(el, 'tags').dispatchEvent(event);
  TestBed.tick();
  return event.defaultPrevented;
}

function type(el: HTMLElement, value: string): void {
  fill(el, 'tags', value);
  TestBed.tick();
}

const options = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[role=option]')].map((o) => text(o));
const chips = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.chip-name')].map((c) => text(c));

describe('TagField (ST-784)', () => {
  beforeEach(() => {
    setUp();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('is a labelled combobox with a hint, stopping at 24 characters', async () => {
    const el = await form();
    const input = field(el, 'tags');
    expect(text(el.querySelector('label[for=tags]'))).toBe('Emneord (valgfritt)');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-describedby')).toBe('tags-hint');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('maxlength')).toBe('24');
    expect(text(el.querySelector('#tags-hint'))).toContain('Enter legger til.');
  });

  it('suggests the tags in use while typing, and offers a new one', async () => {
    const el = await form();
    type(el, 'Mid');
    expect(options(el)).toEqual(['Middag 4', 'Mid nytt emneord']);
    const input = field(el, 'tags');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe('tag-option-0');
    expect(el.querySelector('#tag-option-0')?.getAttribute('aria-selected')).toBe('true');
  });

  it('puts the tags that start with what is typed first', async () => {
    const el = await form();
    type(el, 's');
    expect(options(el)).toEqual(['Suppe 1', 'Fisk 1', 'Høst 1', 'S nytt emneord']);
  });

  it('adds the marked suggestion on Enter, without sending the form', async () => {
    const el = await form();
    type(el, 'mid');
    expect(key(el, 'Enter')).toBe(true);
    expect(chips(el)).toEqual(['Middag']);
    expect(field(el, 'tags').value).toBe('');
    expect(text(el.querySelector('.tag-field [role=status]'))).toBe('Middag er lagt til.');
    // An added tag is not offered again.
    type(el, 'mid');
    expect(options(el)).toEqual(['Mid nytt emneord']);
  });

  it('moves through the suggestions with the arrow keys; Escape closes them', async () => {
    const el = await form();
    type(el, 'mid');
    key(el, 'ArrowDown');
    expect(field(el, 'tags').getAttribute('aria-activedescendant')).toBe('tag-option-1');
    key(el, 'ArrowDown');
    expect(field(el, 'tags').getAttribute('aria-activedescendant')).toBe('tag-option-0');
    key(el, 'ArrowUp');
    expect(key(el, 'Escape')).toBe(true);
    expect(field(el, 'tags').getAttribute('aria-expanded')).toBe('false');
    // Closed, Enter adds what is typed, not the marked suggestion.
    key(el, 'Enter');
    expect(chips(el)).toEqual(['Mid']);
  });

  it('adds a tag picked with the pointer', async () => {
    const el = await form();
    type(el, 'kj');
    el.querySelector<HTMLElement>('#tag-option-0')?.click();
    TestBed.tick();
    expect(chips(el)).toEqual(['Kjøtt']);
    expect(document.activeElement).toBe(field(el, 'tags'));
  });

  it('takes a comma as the end of a tag, and keeps one of each', async () => {
    const el = await form();
    type(el, 'Middag, middag ,Rask  mat,');
    expect(chips(el)).toEqual(['Middag', 'Rask mat']);
  });

  it('removes a tag with "Fjern" and returns to the field', async () => {
    const el = await form();
    type(el, 'fisk,suppe,');
    const remove = el.querySelector<HTMLButtonElement>('.chip-remove');
    expect(remove?.getAttribute('aria-label')).toBe('Fjern emneordet Fisk');
    remove?.click();
    TestBed.tick();
    expect(chips(el)).toEqual(['Suppe']);
    expect(document.activeElement).toBe(field(el, 'tags'));
    expect(text(el.querySelector('.tag-field [role=status]'))).toBe('Fisk er fjernet.');
  });

  it('saves the tags, with one typed but not yet added', async () => {
    const el = await form();
    fill(el, 'title', 'Fiskesuppe');
    fill(el, 'ingredients', '400 g torsk');
    type(el, 'fisk,');
    type(el, '  Rask Mat ');
    const request = submit(el, 'POST', '/api/recipes');
    expect(request.request.body).toEqual({
      title: 'Fiskesuppe',
      ingredients: '400 g torsk',
      instructions: '',
      tags: ['fisk', 'rask mat'],
    });
    request.flush({}, { status: 500, statusText: 'Error' });
  });
});
