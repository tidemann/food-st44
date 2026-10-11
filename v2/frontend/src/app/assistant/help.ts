import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../auth';
import { copier, mcpAddress } from './copy';

/**
 * `/assistent`, «Koble til en assistent» (ST-833, design ST-818 §4): the MCP address with a copy
 * button, the steps for the Claude app, and for editors the steps for a key. Open to everyone;
 * reached from the footer.
 */
@Component({
  selector: 'app-assistant-help',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="page">
        <div class="page-top">
          <p class="crumb">
            <a routerLink="/">Oppskrifter</a> /
            <span aria-current="page">Koble til en assistent</span>
          </p>
        </div>
        <h1>Koble til en assistent</h1>
        <p class="lead">
          En assistent som Claude kan søke i oppskriftene og lese dem. Er du redaktør, kan den også
          legge inn nye og rette de som står der.
        </p>

        <div class="addr">
          <p class="addr-label">ADRESSEN DU LIMER INN</p>
          <div class="addr-row">
            <code>{{ address }}</code>
            <button class="btn" type="button" (click)="clip.copy(address)">
              {{ clip.copied() ? 'Kopiert' : 'Kopier adressen' }}
            </button>
          </div>
        </div>

        <div class="cols">
          <div class="main-col">
            <section class="how">
              <h2>I Claude-appen</h2>
              <p class="sub">Fire steg. Du gjør det én gang per telefon eller maskin.</p>
              <div class="step">
                <span class="n">1</span>
                <p>Åpne Claude-appen og gå til Innstillinger, så Kontakter.</p>
              </div>
              <div class="step">
                <span class="n">2</span>
                <p>Velg «Legg til egen kontakt» og lim inn adressen over.</p>
              </div>
              <div class="step">
                <span class="n">3</span>
                <p>Logg inn med Google-kontoen du bruker på food.st44.no.</p>
              </div>
              <div class="step">
                <span class="n">4</span>
                <p>Godkjenn at Claude får lese og endre oppskrifter. Da er dere i gang.</p>
              </div>
            </section>

            @if (auth.isEditor()) {
              <section class="how keys-how">
                <h2>Nøkkel til andre assistenter</h2>
                <p class="sub">
                  Assistenter som ikke kan logge inn med Google, trenger en nøkkel. Bare redaktører
                  kan lage nøkler.
                </p>
                <div class="step">
                  <span class="n">1</span>
                  <p>
                    Gå til <a routerLink="/assistent/nokler">Nøkler</a> og lag en nøkkel. Gi den
                    navnet til assistenten, for eksempel «Samantha».
                  </p>
                </div>
                <div class="step">
                  <span class="n">2</span>
                  <p>Kopier nøkkelen med en gang. Den vises bare denne ene gangen.</p>
                </div>
                <div class="step">
                  <span class="n">3</span>
                  <p>
                    Lim den inn der assistenten spør etter en nøkkel. Noen kaller det
                    <b>Authorization: Bearer</b>.
                  </p>
                </div>
              </section>
            }
          </div>

          <aside class="side-col">
            <div class="facts">
              <h2>Hva en assistent får lov til</h2>
              <dl>
                <div>
                  <dt>Søke og lese</dt>
                  <dd>Alle</dd>
                </div>
                <div>
                  <dt>Legge inn og endre</dt>
                  <dd>Redaktører</dd>
                </div>
                <div>
                  <dt>Slette</dt>
                  <dd>Ingen</dd>
                </div>
              </dl>
            </div>
            <div class="note">
              <p>
                Alt en assistent legger inn eller endrer, blir loggført med konto, tidspunkt og hva
                som ble endret. Ingen assistent kan slette en oppskrift.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `,
  styleUrl: './assistant.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantHelp {
  protected readonly auth = inject(Auth);
  protected readonly address = mcpAddress();
  protected readonly clip = copier();

  constructor() {
    inject(Title).setTitle('Koble til en assistent — food.st44.no');
  }
}
