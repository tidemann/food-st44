// Test helpers: the real routes on a fake backend. Imported by *.spec.ts only.
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Recipe } from './api/types';
import { routes } from './app.routes';

export function recipe(id: number, title: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    title,
    ingredients: '600 g kjøttdeig\n1 egg\nsalt og pepper',
    instructions: 'Bland.\n\nStek.',
    created_at: `2026-09-${String(10 + id).padStart(2, '0')}T10:00:00Z`,
    ...overrides,
  };
}

export class Page {
  private constructor(
    readonly harness: RouterTestingHarness,
    readonly http: HttpTestingController,
  ) {}

  static async create(): Promise<Page> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    return new Page(await RouterTestingHarness.create(), TestBed.inject(HttpTestingController));
  }

  get el(): HTMLElement {
    return this.harness.routeNativeElement ?? document.body;
  }

  get url(): string {
    return TestBed.inject(Router).url;
  }

  /** Starts a navigation without waiting for it: the page's requests are still open. */
  async go(url: string): Promise<void> {
    void this.harness.navigateByUrl(url);
    await this.settle();
  }

  /** Lets navigation, effects and rendering catch up with whatever was flushed. */
  async settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();
    }
  }

  /** The unfiltered list the masthead, footer and front page read. */
  site(): TestRequest {
    return this.http.expectOne((r) => r.url === '/api/recipes' && !r.params.has('q'));
  }

  search(q: string): TestRequest {
    return this.http.expectOne((r) => r.url === '/api/recipes' && r.params.get('q') === q);
  }

  text(selector: string): string {
    return this.el.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  }

  all(selector: string): string[] {
    return [...this.el.querySelectorAll(selector)].map((node) =>
      node.textContent.replace(/\s+/g, ' ').trim(),
    );
  }
}
