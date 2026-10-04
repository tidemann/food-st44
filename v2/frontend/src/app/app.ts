import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Site } from './site';

/**
 * The frame around every page: skip link, the routed page (its own masthead + main#main), the
 * footer. The page owns its masthead because the masthead changes with the page (inventory §2.0).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly site = inject(Site);
  private readonly document = inject(DOCUMENT);

  // A plain href="#main" would resolve against <base href="/"> and leave the page.
  protected skipToMain(event: Event): void {
    event.preventDefault();
    const main = this.document.getElementById('main');
    main?.focus();
    main?.scrollIntoView();
  }
}
