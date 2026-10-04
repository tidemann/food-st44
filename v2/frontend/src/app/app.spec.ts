import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import type { Health } from './api/types';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('shows the API status from /healthz', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();

    const body: Health = { status: 'ok' };
    http.expectOne('/healthz').flush(body);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status')?.textContent).toContain('API: ok');
    http.verify();
  });
});
