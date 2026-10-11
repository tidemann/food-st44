import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { ApiKey } from '../api/types';
import { ServerError } from '../pages/server-error';
import { formatLastUsed, formatLong, pluralise } from '../recipes/format';

/** `/assistent/nokler` (ST-833, design ST-818 §1): the editor's keys, newest first. Editors only. */
@Component({
  selector: 'app-assistant-keys',
  imports: [RouterLink, ServerError],
  template: `
    @if (keys.error()) {
      <app-server-error />
    } @else if (keys.hasValue()) {
      <div class="wrap">
        <div class="page">
          <div class="page-top">
            <p class="crumb">
              <a routerLink="/">Oppskrifter</a> /
              <a routerLink="/assistent">Koble til en assistent</a> /
              <span aria-current="page">Nøkler</span>
            </p>
          </div>
          <h1>Nøkler</h1>
          <p class="lead">
            En nøkkel lar én assistent bruke oppskriftene som deg. Lag én per assistent, og slett
            den du ikke bruker lenger.
          </p>

          <div class="keyhead">
            @if (rows().length) {
              <h2>{{ count() }} <span class="m">· nyeste først</span></h2>
            } @else {
              <h2>Ingen nøkler ennå</h2>
            }
            <a class="btn btn-primary" routerLink="/assistent/nokler/ny">Lag ny nøkkel</a>
          </div>

          @if (rows().length) {
            <ul class="keys">
              @for (key of rows(); track key.id) {
                <li class="key">
                  <div class="key-text">
                    <h3>{{ key.name }}</h3>
                    <p class="m">
                      <b>{{ key.prefix }}…</b> · Laget {{ key.created }}
                    </p>
                    <p class="m">
                      @if (key.lastUsed) {
                        Sist brukt <b>{{ key.lastUsed }}</b>
                      } @else {
                        Aldri brukt
                      }
                    </p>
                  </div>
                  <div class="acts">
                    <a
                      class="btn btn-danger-ghost"
                      [routerLink]="['/assistent/nokler', key.id, 'slett']"
                      [attr.aria-label]="'Slett nøkkelen «' + key.name + '»'"
                      >Slett</a
                    >
                  </div>
                </li>
              }
            </ul>
          } @else {
            <div class="note">
              <p>
                Claude-appen trenger ingen nøkkel — der logger dere inn med Google. En nøkkel er til
                assistenter som ikke kan det, for eksempel Samantha.
              </p>
            </div>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './assistant.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantKeys {
  protected readonly keys = httpResource<ApiKey[]>(() => '/api/keys');

  protected readonly rows = computed(() =>
    (this.keys.hasValue() ? this.keys.value() : []).map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      created: formatLong(key.created_at),
      lastUsed: key.last_used_at ? formatLastUsed(key.last_used_at) : '',
    })),
  );
  protected readonly count = computed(() => pluralise(this.rows().length, 'nøkkel', 'nøkler'));

  constructor() {
    inject(Title).setTitle('Nøkler — food.st44.no');
  }
}
