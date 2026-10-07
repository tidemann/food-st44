// Cooking mode's time reader: finds the times a step mentions ("ca. 10 minutter", "1½ time",
// "20–25 min") so the step can offer a timer for each. Pure, so it is tested on its own.

/** One time in a step's text. `start`/`end` index the text, for the highlight. */
export interface StepTime {
  /** As written, e.g. "ca. 10 minutter". */
  text: string;
  start: number;
  end: number;
  /** The time in seconds. A range ("20–25 min") counts as its upper bound. */
  seconds: number;
}

const WORDS: Partial<Record<string, number>> = {
  en: 1,
  ei: 1,
  et: 1,
  ett: 1,
  én: 1,
  to: 2,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  sju: 7,
  syv: 7,
  åtte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
  femten: 15,
  tjue: 20,
  tretti: 30,
  førti: 40,
  femti: 50,
  halvannen: 1.5,
  halvannet: 1.5,
};
const FRACTIONS: Partial<Record<string, number>> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

// Longest first, so "ett minutt" is not read as "et" + "t" (an hour).
const WORD = Object.keys(WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');
// "10", "1,5", "1½", "1 1/2", "½", "en halv", "ti".
const NUMBER = `(?:\\d+(?:[.,]\\d+)?(?:\\s*(?:[¼½¾]|\\d\\/\\d))?|[¼½¾]|(?:en|ei|et|ett)\\s+halv|${WORD})`;
const UNIT = 'timer|time|t|minutter|minutt|min|sekunder|sekund|sek|kvarter';
// Optional "ca." in front, a number or a range of two, then the unit, standing as a word.
const TIME = new RegExp(
  `(?<![\\p{L}\\d])((?:(?:ca\\.?|cirka|omtrent)\\s*)?)(${NUMBER})(?:\\s*(?:[-–—]|til)\\s*(${NUMBER}))?\\s*(${UNIT})(?![\\p{L}\\d])`,
  'giu',
);

const UNIT_SECONDS: [RegExp, number][] = [
  [/^t/i, 3600],
  [/^min/i, 60],
  [/^sek/i, 1],
  [/^kvarter$/i, 900],
];

/** "1,5" → 1.5, "1½" → 1.5, "1 1/2" → 1.5, "en halv" → 0.5, "ti" → 10. */
export function readNumber(value: string): number {
  const text = value.trim().toLowerCase();
  const word = WORDS[text];
  if (word !== undefined) return word;
  if (/^(?:en|ei|et|ett)\s+halv$/.test(text)) return 0.5;
  const match = /^(\d+(?:[.,]\d+)?)?\s*(?:([¼½¾])|(\d)\/(\d))?$/.exec(text);
  if (!match) return Number.NaN;
  const [, whole, fraction, top, bottom] = match;
  let number = whole ? Number(whole.replace(',', '.')) : 0;
  if (fraction) number += FRACTIONS[fraction] ?? 0;
  if (top && bottom) number += Number(top) / Number(bottom);
  return number;
}

function unitSeconds(unit: string): number {
  return UNIT_SECONDS.find(([pattern]) => pattern.test(unit))?.[1] ?? 0;
}

/** Every time the step mentions, in order. "1 time og 15 minutter" is one time. */
export function readTimes(step: string): StepTime[] {
  const times: StepTime[] = [];
  let lastUnit = 0;
  for (const match of step.matchAll(TIME)) {
    const [text, , from = '', to, unitText = ''] = match;
    const unit = unitSeconds(unitText);
    const amount = readNumber(to ?? from);
    if (!unit || !Number.isFinite(amount) || amount <= 0) continue;
    const start = match.index;
    const end = start + text.length;
    const seconds = Math.round(amount * unit);
    // An hour followed by minutes ("1 time og 15 minutter", "1 t 30 min") adds up.
    const last = times.at(-1);
    if (
      last &&
      lastUnit === 3600 &&
      unit === 60 &&
      /^\s*(?:og\s+)?$/i.test(step.slice(last.end, start))
    ) {
      last.seconds += seconds;
      last.end = end;
      last.text = step.slice(last.start, end);
    } else {
      times.push({ text, start, end, seconds });
    }
    lastUnit = unit;
  }
  return times;
}

/** A step's text cut around its times, for the highlight. */
export interface StepPart {
  text: string;
  time: StepTime | null;
}

export function stepParts(step: string, times: readonly StepTime[]): StepPart[] {
  const parts: StepPart[] = [];
  let at = 0;
  for (const time of times) {
    if (time.start > at) parts.push({ text: step.slice(at, time.start), time: null });
    parts.push({ text: time.text, time });
    at = time.end;
  }
  if (at < step.length) parts.push({ text: step.slice(at), time: null });
  return parts;
}

/** 600 → "10:00", 3725 → "1:02:05". Rounds up, so a timer never shows 0:00 while it runs. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h ? `${String(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 600 → "10 minutter", 90 → "1 minutt og 30 sekunder", 5400 → "1 time og 30 minutter". */
export function formatSpoken(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${String(h)} ${h === 1 ? 'time' : 'timer'}`);
  if (m) parts.push(`${String(m)} ${m === 1 ? 'minutt' : 'minutter'}`);
  if (s || !parts.length) parts.push(`${String(s)} ${s === 1 ? 'sekund' : 'sekunder'}`);
  return parts.join(' og ');
}
