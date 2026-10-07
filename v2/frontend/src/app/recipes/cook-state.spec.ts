import { stepFrom, Ticks, Timers } from './cook-state';

describe('stepFrom', () => {
  it.each([
    [undefined, 7, 1],
    ['3', 7, 3],
    ['7', 7, 7],
    ['9', 7, 7],
    ['0', 7, 1],
    ['-2', 7, 1],
    ['tre', 7, 1],
    ['2', 0, 1],
  ])('?steg=%s of %i is step %i', (value, count, expected) => {
    expect(stepFrom(value, count)).toBe(expected);
  });
});

describe('Ticks', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('ticks and unticks, and remembers it per recipe', () => {
    const ticks = new Ticks(9, sessionStorage);
    ticks.toggle(5);
    ticks.toggle(0);
    expect(ticks.has(0)).toBe(true);
    expect(ticks.count()).toBe(2);
    expect(sessionStorage.getItem('food.cook.9.ticks')).toBe('[0,5]');
    ticks.toggle(5);
    expect(ticks.has(5)).toBe(false);

    const again = new Ticks(9, sessionStorage);
    expect([...again.ticked()]).toEqual([0]);
    expect(new Ticks(8, sessionStorage).count()).toBe(0);
  });

  it('"Nullstill" clears the ticks, "Avslutt" forgets them', () => {
    const ticks = new Ticks(9, sessionStorage);
    ticks.toggle(1);
    ticks.reset();
    expect(ticks.count()).toBe(0);
    expect(sessionStorage.getItem('food.cook.9.ticks')).toBe('[]');
    ticks.toggle(2);
    ticks.forget();
    expect(sessionStorage.getItem('food.cook.9.ticks')).toBeNull();
  });

  it('ignores what it cannot read, and works without storage', () => {
    sessionStorage.setItem('food.cook.9.ticks', 'nonsens');
    expect(new Ticks(9, sessionStorage).count()).toBe(0);
    sessionStorage.setItem('food.cook.9.ticks', '[1,"x",2.5,3]');
    expect([...new Ticks(9, sessionStorage).ticked()]).toEqual([1, 3]);
    const ticks = new Ticks(9, null);
    ticks.toggle(0);
    expect(ticks.has(0)).toBe(true);
  });
});

describe('Timers', () => {
  it('counts down and finishes', () => {
    const timers = new Timers();
    timers.start(3, 600, false, 0);
    timers.tick(126_000);
    expect(timers.timers()[0]?.remaining).toBe(474);
    expect(timers.timers()[0]?.progress).toBeCloseTo(0.21);
    expect(timers.tick(599_000)).toEqual([]);
    const ended = timers.tick(600_000);
    expect(ended.map((t) => t.step)).toEqual([3]);
    expect(timers.finished().length).toBe(1);
    expect(timers.running().length).toBe(0);
    expect(timers.tick(601_000)).toEqual([]);
  });

  it('runs several at once', () => {
    const timers = new Timers();
    timers.start(3, 600, false, 0);
    timers.start(5, 300, true, 60_000);
    expect(timers.tick(360_000).map((t) => t.step)).toEqual([5]);
    expect(timers.running().map((t) => t.step)).toEqual([3]);
  });

  it('pauses and resumes', () => {
    const timers = new Timers();
    const { id } = timers.start(3, 60, false, 0);
    timers.pause(id, 20_000);
    timers.tick(500_000);
    expect(timers.timers()[0]?.remaining).toBe(40);
    expect(timers.timers()[0]?.running).toBe(false);
    timers.resume(id, 500_000);
    expect(timers.tick(539_000)).toEqual([]);
    expect(timers.tick(540_000).length).toBe(1);
  });

  it('"+ 1 minutt" runs a finished timer again; a removed one is gone', () => {
    const timers = new Timers();
    const { id } = timers.start(3, 10, false, 0);
    timers.tick(10_000);
    timers.extend(id, 60, 12_000);
    expect(timers.timers()[0]?.remaining).toBe(60);
    expect(timers.tick(72_000).length).toBe(1);
    timers.remove(id);
    expect(timers.timers()).toEqual([]);
  });
});
