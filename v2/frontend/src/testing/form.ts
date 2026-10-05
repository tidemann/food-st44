// Typing into and submitting the recipe form, and answering the save, for the write-side tests.
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import type { ValidationErrors } from '../app/api/types';

export function field(el: HTMLElement, id: string): HTMLInputElement | HTMLTextAreaElement {
  const found = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!found) throw new Error(`no field #${id}`);
  return found;
}

/** Types `value` into the field, as a user would (one input event). */
export function fill(el: HTMLElement, id: string, value: string): void {
  const control = field(el, id);
  control.value = value;
  control.dispatchEvent(new Event('input'));
}

export function submitButton(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('no submit button');
  return button;
}

/** Presses the submit button and returns the request it sent. */
export function submit(el: HTMLElement, method: string, url: string): TestRequest {
  submitButton(el).click();
  TestBed.tick();
  return TestBed.inject(HttpTestingController).expectOne({ method, url });
}

/**
 * Resolves when the page has navigated away (after a save). Take it before answering the save:
 * `whenStable()` would wait for the next page's requests, which the test has yet to answer.
 */
export function navigation(): Promise<NavigationEnd> {
  return firstValueFrom(
    TestBed.inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd)),
  );
}

/** A file as the browser hands it over. `size` stands in for the bytes, so 30 MB costs nothing. */
export function photoFile(name: string, type: string, size = 2.4 * 2 ** 20): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Picks `file` in the photo field's file input: `photo` ("Velg bilde") or `photo-camera`. */
export function choose(el: HTMLElement, file: File, id = 'photo'): void {
  const input = el.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no file input #${id}`);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  TestBed.tick();
}

/** Answers a save with the API's 422 for the form's fields. */
export function reject(request: TestRequest, errors: ValidationErrors['errors']): void {
  const body: ValidationErrors = { errors };
  request.flush(body, { status: 422, statusText: 'Unprocessable Entity' });
}
