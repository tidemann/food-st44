import { formatClock, formatSpoken, readNumber, readTimes, stepParts } from './cook-time';

const seconds = (step: string): number[] => readTimes(step).map((t) => t.seconds);
const texts = (step: string): string[] => readTimes(step).map((t) => t.text);

describe('readTimes', () => {
  it.each([
    ['La det koke i 10 minutter.', 600],
    ['Stek i 1 time.', 3600],
    ['Kok i 2 timer under lokk.', 7200],
    ['Stek i 1½ time.', 5400],
    ['Stek i 1 1/2 time.', 5400],
    ['Stek i 1,5 time.', 5400],
    ['Stek i 20–25 min.', 1500],
    ['Stek i 20-25 minutter.', 1500],
    ['Stek i 20 til 25 minutter.', 1500],
    ['Mikrobølgeovn i 30 sek.', 30],
    ['Visp i 45 sekunder.', 45],
    ['La deigen heve i en time.', 3600],
    ['La det stå en halv time.', 1800],
    ['Kok i halvannen time.', 5400],
    ['La det trekke et kvarter.', 900],
    ['Kok i ti minutter.', 600],
    ['Kok i ett minutt.', 60],
    ['Kok i 1 minutt.', 60],
    ['Hvil 5 min, og server.', 300],
    ['Stek 1 t 30 min.', 5400],
    ['Kok i 1 time og 15 minutter.', 4500],
  ])('%s → %i s', (step, expected) => {
    expect(seconds(step)).toEqual([expected]);
  });

  it('keeps "ca." with the time it belongs to', () => {
    const step = 'Brun dem i varm panne, ca. 10 minutter, til de er gylne.';
    const [time] = readTimes(step);
    expect(time?.text).toBe('ca. 10 minutter');
    expect(step.slice(time?.start, time?.end)).toBe('ca. 10 minutter');
  });

  it('finds every time in a step, in order', () => {
    expect(texts('Kok poteter i 20 min. Stek kjøttet 5 minutter på hver side.')).toEqual([
      '20 min',
      '5 minutter',
    ]);
  });

  it.each([
    'Bland kjøttdeig og salt.',
    'Stek på 200 grader.',
    'Tilsett 2 ts salt og 1 ts pepper.',
    'Del i 4 timianstilker.',
    'Bruk minst 3 egg.',
    'Kok opp, og la det stå til minuttet før servering.',
    'Tilsett 0 minutter.',
  ])('finds nothing in "%s"', (step) => {
    expect(readTimes(step)).toEqual([]);
  });
});

describe('readNumber', () => {
  it.each([
    ['10', 10],
    ['1,5', 1.5],
    ['1.5', 1.5],
    ['1½', 1.5],
    ['1 1/2', 1.5],
    ['½', 0.5],
    ['¾', 0.75],
    ['en halv', 0.5],
    ['halvannen', 1.5],
    ['tjue', 20],
    ['Fem', 5],
  ])('%s → %d', (text, expected) => {
    expect(readNumber(text)).toBe(expected);
  });

  it('is NaN for anything else', () => {
    expect(readNumber('mange')).toBeNaN();
  });
});

describe('stepParts', () => {
  it('cuts the text around its times', () => {
    const step = 'La sausen koke i 5 minutter.';
    expect(stepParts(step, readTimes(step)).map((p) => [p.text, p.time?.seconds ?? null])).toEqual([
      ['La sausen koke i ', null],
      ['5 minutter', 300],
      ['.', null],
    ]);
  });

  it('is the whole text when there is no time', () => {
    expect(stepParts('Server.', [])).toEqual([{ text: 'Server.', time: null }]);
  });
});

describe('formatClock', () => {
  it.each([
    [600, '10:00'],
    [126, '02:06'],
    [0.2, '00:01'],
    [0, '00:00'],
    [-3, '00:00'],
    [3725, '1:02:05'],
  ])('%d → %s', (value, expected) => {
    expect(formatClock(value)).toBe(expected);
  });
});

describe('formatSpoken', () => {
  it.each([
    [600, '10 minutter'],
    [60, '1 minutt'],
    [90, '1 minutt og 30 sekunder'],
    [3600, '1 time'],
    [5400, '1 time og 30 minutter'],
    [30, '30 sekunder'],
  ])('%d → %s', (value, expected) => {
    expect(formatSpoken(value)).toBe(expected);
  });
});
