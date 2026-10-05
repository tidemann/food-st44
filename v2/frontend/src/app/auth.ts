import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { type CanMatchFn, type Params, Router, type UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Me } from './api/types';

/** Nobody signed in. Also what a failed /api/auth/me means: the site is then read-only. */
export const SIGNED_OUT: Me = {
  signed_in: false,
  name: '',
  initial: '',
  is_editor: false,
  sign_in_available: false,
};

/** `?login=ok` marks the page Google sent the reader back to; `?login=failed` a failed sign-in. */
export const LOGIN_PARAM = 'login';

/**
 * Who is reading (M2). Anyone may read; only accounts on the household's editor list see
 * "Ny oppskrift", "Rediger" and "Slett" and get the forms. The API refuses everyone else with 403
 * anyway, so this is about not offering what would fail.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly current = signal<Me | undefined>(undefined);
  /** undefined until /api/auth/me has answered. */
  readonly me = this.current.asReadonly();
  readonly isEditor = computed(() => this.current()?.is_editor === true);

  /** Settles once /api/auth/me has answered (or failed); the route guards wait for it. */
  readonly ready: Promise<Me> = firstValueFrom(this.http.get<Me>('/api/auth/me'))
    .catch(() => SIGNED_OUT)
    .then((me) => {
      this.current.set(me);
      return me;
    });

  /**
   * Google sign-in is a full page load through the backend. It comes back to `url` with
   * `?login=ok`, so the app can say "Ingen tilgang" to an account that is not on the list.
   */
  signInHref(url: UrlTree): string {
    const next = withQuery(this.router, url, { flash: null, [LOGIN_PARAM]: 'ok' });
    return `/api/auth/google/login?next=${encodeURIComponent(this.router.serializeUrl(next))}`;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post<null>('/api/auth/logout', null));
    const available = this.current()?.sign_in_available ?? false;
    this.current.set({ ...SIGNED_OUT, sign_in_available: available });
  }
}

/** A copy of `url` with query parameters set, or removed where the value is null. */
export function withQuery(
  router: Router,
  url: UrlTree,
  changes: Record<string, string | null>,
): UrlTree {
  const copy = router.parseUrl(router.serializeUrl(url));
  const params: Params = { ...copy.queryParams, ...changes };
  copy.queryParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null),
  );
  return copy;
}

/** New, edit and delete are only matched for editors; anyone else falls through to NoAccess. */
export const editorOnly: CanMatchFn = async () => {
  const auth = inject(Auth);
  await auth.ready;
  return auth.isEditor();
};
