// Cooking mode's state, kept out of the component so it can be tested without a browser:
// which step is on screen, which ingredients are ticked off, and the running timers.
import { computed, signal, type Signal, type WritableSignal } from '@angular/core';

/** `?steg=3` as a step number from 1 to `count`; anything else is the first step. */
export function stepFrom(value: string | undefined, count: number): number {
  const step = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(step) || step < 1) return 1;
  return Math.min(step, Math.max(count, 1));
}

/**
 * The ingredients ticked off, by their place in the list. Kept in `sessionStorage` per recipe, so
 * a reload or a look at the recipe page keeps them until the cook presses "Avslutt".
 */
export class Ticks {
  private readonly key: string;
  private readonly storage: Storage | null;
  private readonly state: WritableSignal<ReadonlySet<number>>;
  readonly ticked: Signal<ReadonlySet<number>>;
  readonly count: Signal<number>;

  constructor(recipeId: number, storage: Storage | null) {
    this.key = `food.cook.${String(recipeId)}.ticks`;
    this.storage = storage;
    this.state = signal(new Set(this.read()));
    this.ticked = this.state.asReadonly();
    this.count = computed(() => this.state().size);
  }

  has(index: number): boolean {
    return this.state().has(index);
  }

  toggle(index: number): void {
    const next = new Set(this.state());
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this.state.set(next);
    this.write();
  }

  /** "Nullstill": nothing ticked, still remembered as nothing. */
  reset(): void {
    this.state.set(new Set());
    this.write();
  }

  /** "Avslutt": forget this recipe's ticks. */
  forget(): void {
    this.state.set(new Set());
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Storage switched off: there is nothing to forget.
    }
  }

  private read(): number[] {
    try {
      const value: unknown = JSON.parse(this.storage?.getItem(this.key) ?? '[]');
      return Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify([...this.state()].sort((a, b) => a - b)));
    } catch {
      // Storage full or switched off: the ticks still hold until the page is left.
    }
  }
}

export interface Timer {
  id: number;
  /** The step it was started from, 1-based. */
  step: number;
  /** True for "Sett egen tid", false for a time read from the step. */
  own: boolean;
  /** Length in seconds. */
  total: number;
  /** When it ends (ms), while it runs; null while paused or done. */
  endsAt: number | null;
  /** Seconds left while paused. */
  left: number;
  done: boolean;
}

/** A timer as the screen shows it. */
export interface TimerView extends Timer {
  remaining: number;
  /** 0 → 1, how far it has run. */
  progress: number;
  running: boolean;
}

/** The running timers. Several can run at once; `now` is passed in so tests set the clock. */
export class Timers {
  private next = 1;
  private readonly list = signal<readonly Timer[]>([]);
  private readonly now = signal(0);

  readonly timers = computed<TimerView[]>(() => {
    const now = this.now();
    return this.list().map((timer) => {
      const remaining = timer.done
        ? 0
        : timer.endsAt === null
          ? timer.left
          : Math.max(0, (timer.endsAt - now) / 1000);
      return {
        ...timer,
        remaining,
        progress: timer.total ? 1 - remaining / timer.total : 1,
        running: timer.endsAt !== null && !timer.done,
      };
    });
  });
  readonly running = computed(() => this.timers().filter((t) => !t.done));
  readonly finished = computed(() => this.timers().filter((t) => t.done));

  start(step: number, seconds: number, own: boolean, now: number): Timer {
    const timer: Timer = {
      id: this.next++,
      step,
      own,
      total: seconds,
      endsAt: now + seconds * 1000,
      left: seconds,
      done: false,
    };
    this.now.set(now);
    this.list.update((list) => [...list, timer]);
    return timer;
  }

  pause(id: number, now: number): void {
    this.tick(now);
    this.change(id, (t) =>
      t.endsAt === null || t.done
        ? t
        : { ...t, endsAt: null, left: Math.max(0, (t.endsAt - now) / 1000) },
    );
  }

  resume(id: number, now: number): void {
    this.change(id, (t) =>
      t.endsAt !== null || t.done ? t : { ...t, endsAt: now + t.left * 1000 },
    );
    this.now.set(now);
  }

  /** "+ 1 minutt" on a finished timer: it runs again for that long. */
  extend(id: number, seconds: number, now: number): void {
    this.change(id, (t) => ({
      ...t,
      total: seconds,
      endsAt: now + seconds * 1000,
      left: seconds,
      done: false,
    }));
    this.now.set(now);
  }

  remove(id: number): void {
    this.list.update((list) => list.filter((t) => t.id !== id));
  }

  /** Moves the clock on and returns the timers that ran out just now. */
  tick(now: number): Timer[] {
    this.now.set(now);
    const ended = this.list().filter((t) => !t.done && t.endsAt !== null && t.endsAt <= now);
    if (ended.length) {
      const ids = new Set(ended.map((t) => t.id));
      this.list.update((list) =>
        list.map((t) => (ids.has(t.id) ? { ...t, done: true, endsAt: null, left: 0 } : t)),
      );
    }
    return ended;
  }

  private change(id: number, update: (timer: Timer) => Timer): void {
    this.list.update((list) => list.map((t) => (t.id === id ? update(t) : t)));
  }
}
