import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { Site } from '../site';
import { stepFrom, Ticks, Timers, type TimerView } from './cook-state';
import { formatClock, formatSpoken, readTimes, stepParts } from './cook-time';
import { ingredientsFor, stepsFor } from './format';
import { loadRecipe, parseId } from './load';

/** How far a finger has to travel sideways before it counts as a swipe. */
const SWIPE = 50;
/** The alarm stops on its own after this long if nobody is there to stop it. */
const ALARM_MS = 60_000;

/**
 * `/recipes/:id/cook?steg=3` (ST-752): one step at a time in large type, the ingredients one tap
 * away, timers, and the screen kept on. Signed-off screens: ST-699.
 */
@Component({
  selector: 'app-recipe-cook',
  imports: [RouterLink, NotFound, ServerError],
  templateUrl: './recipe-cook.html',
  styleUrl: './recipe-cook.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
    '(document:visibilitychange)': 'onVisibility()',
  },
})
export class RecipeCook {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** `?steg=3`, so a reload keeps the step. */
  readonly steg = input<string>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly site = inject(Site);

  private readonly load = loadRecipe(this.id);
  protected readonly state = this.load.state;

  protected readonly view = computed(() => {
    const recipe = this.load.recipe.hasValue() ? this.load.recipe.value() : undefined;
    if (!recipe) return undefined;
    return {
      recipe,
      ingredients: ingredientsFor(recipe.ingredients),
      steps: stepsFor(recipe.instructions).map((text) => {
        const times = readTimes(text);
        return { text, times, parts: stepParts(text, times) };
      }),
    };
  });
  protected readonly count = computed(() => this.view()?.steps.length ?? 0);
  /** The step on screen, 1-based. */
  protected readonly step = computed(() => stepFrom(this.steg(), this.count()));
  protected readonly current = computed(() => this.view()?.steps[this.step() - 1]);

  /** Ticked-off ingredients, per recipe, in `sessionStorage`. */
  protected readonly ticks = computed(() => new Ticks(parseId(this.id()) ?? 0, storage()));
  protected readonly timers = new Timers();

  /** The ingredients sheet on a phone (on a tablet the list is always beside the step). */
  protected readonly sheet = signal(false);
  /** "Sett egen tid" open. */
  protected readonly custom = signal(false);
  /** True while the Wake Lock holds; "Skjermen står på" is shown only then. */
  protected readonly awake = signal(false);
  protected readonly ringing = signal(false);

  private readonly sheetClose = viewChild<ElementRef<HTMLButtonElement>>('sheetClose');
  private readonly sheetOpen = viewChild<ElementRef<HTMLButtonElement>>('sheetOpen');
  private readonly minutes = viewChild<ElementRef<HTMLInputElement>>('minutes');

  private lock: WakeLockSentinel | null = null;
  private audio: AudioContext | null = null;
  private alarm: ReturnType<typeof setInterval> | undefined;
  private alarmStop: ReturnType<typeof setTimeout> | undefined;
  private touch: { x: number; y: number } | null = null;
  private left = false;

  protected readonly clock = formatClock;

  constructor() {
    const title = inject(Title);
    // The masthead steps aside only while there is something to cook; a missing recipe or a
    // failed load is shown inside the site as usual.
    effect(() => {
      const state = this.state();
      this.site.cooking.set(state === 'ready' || state === 'loading');
    });
    effect(() => {
      const view = this.view();
      if (this.state() !== 'ready' || !view) return;
      if (!view.steps.length) {
        // Nothing to cook from: the recipe page asks for the steps instead.
        void this.router.navigate(['/recipes', view.recipe.id], { replaceUrl: true });
        return;
      }
      title.setTitle(`Matlaging: ${view.recipe.title} — food.st44.no`);
    });

    void this.keepAwake();
    const ticker = setInterval(() => {
      this.tick();
    }, 250);

    inject(DestroyRef).onDestroy(() => {
      this.left = true;
      clearInterval(ticker);
      this.stopAlarm();
      void this.audio?.close();
      void this.lock?.release();
      this.lock = null;
      this.site.cooking.set(false);
    });
  }

  // ---------- steps ----------

  protected go(step: number): void {
    if (step < 1 || step > this.count() || step === this.step()) return;
    this.custom.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { steg: step },
      replaceUrl: true,
    });
  }

  /** "Avslutt" and "Ferdig": the ticks are forgotten, the timers stop with the page. */
  protected leave(): void {
    this.ticks().forget();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') {
      if (this.sheet()) this.closeSheet();
      else this.custom.set(false);
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowRight') this.go(this.step() + 1);
    else if (event.key === 'ArrowLeft') this.go(this.step() - 1);
  }

  protected onTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    this.touch = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  protected onTouchEnd(event: TouchEvent): void {
    const start = this.touch;
    const touch = event.changedTouches[0];
    this.touch = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this.go(this.step() + (dx < 0 ? 1 : -1));
  }

  // ---------- ingredients ----------

  protected openSheet(): void {
    this.sheet.set(true);
    afterNextRender(() => this.sheetClose()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeSheet(): void {
    this.sheet.set(false);
    afterNextRender(() => this.sheetOpen()?.nativeElement.focus(), { injector: this.injector });
  }

  // ---------- timers ----------

  protected startTimer(seconds: number, own: boolean): void {
    this.unlockAudio();
    this.timers.start(this.step(), seconds, own, Date.now());
    this.custom.set(false);
  }

  protected openCustom(): void {
    this.custom.set(true);
    afterNextRender(() => this.minutes()?.nativeElement.focus(), { injector: this.injector });
  }

  protected startCustom(event: Event, value: string): void {
    event.preventDefault();
    const minutes = Number(value.replace(',', '.'));
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.startTimer(Math.round(Math.min(minutes, 600) * 60), true);
  }

  /** The minutes "Sett egen tid" starts with: the step's own time, or five. */
  protected readonly suggested = computed(() => {
    const time = this.current()?.times[0];
    return time ? Math.max(1, Math.round(time.seconds / 60)) : 5;
  });

  protected toggle(timer: TimerView): void {
    if (timer.running) this.timers.pause(timer.id, Date.now());
    else this.timers.resume(timer.id, Date.now());
  }

  protected cancel(timer: TimerView): void {
    this.timers.remove(timer.id);
  }

  /** "Stopp lyden": the message goes, and the sound with it once no timer is left ringing. */
  protected dismiss(timer: TimerView): void {
    this.timers.remove(timer.id);
    if (!this.timers.finished().length) this.stopAlarm();
  }

  protected oneMore(timer: TimerView): void {
    this.unlockAudio();
    this.timers.extend(timer.id, 60, Date.now());
    if (!this.timers.finished().length) this.stopAlarm();
  }

  protected label(timer: TimerView): string {
    return `Steg ${String(timer.step)}${timer.own ? ' · egen tid' : ''}`;
  }

  protected spoken(timer: TimerView): string {
    return `Steg ${String(timer.step)} — ${formatSpoken(timer.total)} er gått.`;
  }

  private tick(): void {
    if (!this.timers.timers().length) return;
    if (this.timers.tick(Date.now()).length) this.ring();
  }

  // ---------- the end of a timer: sound, vibration, message ----------

  /** Web Audio only plays after a tap, so the context is made (or woken) on "Start timer". */
  private unlockAudio(): void {
    if (!('AudioContext' in window)) return;
    this.audio ??= new AudioContext();
    if (this.audio.state === 'suspended') void this.audio.resume();
  }

  private ring(): void {
    if ('vibrate' in navigator) navigator.vibrate([400, 200, 400, 200, 400]);
    if (this.ringing()) return;
    this.ringing.set(true);
    this.beep();
    this.alarm = setInterval(() => {
      this.beep();
    }, 1500);
    this.alarmStop = setTimeout(() => {
      this.stopAlarm();
    }, ALARM_MS);
  }

  private stopAlarm(): void {
    clearInterval(this.alarm);
    clearTimeout(this.alarmStop);
    this.ringing.set(false);
  }

  /** Three short tones. */
  private beep(): void {
    const audio = this.audio;
    if (audio?.state !== 'running') return;
    const start = audio.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const at = start + i * 0.28;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.22);
    }
  }

  // ---------- the screen stays on ----------

  protected onVisibility(): void {
    // The browser lets go of the lock when the page is hidden; take it again on return.
    if (document.visibilityState === 'visible' && !this.lock) void this.keepAwake();
  }

  private async keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.left) {
        void lock.release();
        return;
      }
      this.lock = lock;
      this.awake.set(true);
      lock.addEventListener('release', () => {
        if (this.lock === lock) this.lock = null;
        this.awake.set(false);
      });
    } catch {
      // Refused (battery saver, no permission): cooking mode works, the screen may dim.
      this.awake.set(false);
    }
  }
}

/** `sessionStorage`, or null where the browser refuses it. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
