// The recipe's description (ST-1937): a few sentences with a little formatting typed as HTML
// tags. The server (food/description.py) cleans it on every save and checks its length; this
// file only mirrors those rules for the form's preview and counter, so what the editor sees is
// what will be stored.

/** At most this many characters of text, tags not counted. The server checks the same number. */
export const MAX_CHARS = 500;

/** The tags the description may use, as the form's help lists them. */
export const ALLOWED = [
  '<b>',
  '<strong>',
  '<i>',
  '<em>',
  '<u>',
  '<br>',
  '<p>',
  '<ul>',
  '<ol>',
  '<li>',
  '<a href="https://…">',
] as const;

const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'a']);
/** Removed with everything in them, as on the server. Other tags leave their text. */
const DROPPED = new Set(['script', 'style']);
/** Tags that end a line: the plain text keeps their words apart. */
const BREAKS = new Set(['br', 'p', 'ul', 'ol', 'li']);
const REL = 'noopener nofollow';

function parse(html: string): Node {
  // An inert document: nothing in it loads or runs.
  return new DOMParser().parseFromString(html, 'text/html').body;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function linkAddress(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? href.trim() : null;
  } catch {
    // A relative address: the server drops it too.
    return null;
  }
}

function cleaned(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escape(child.textContent ?? '');
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.localName;
    if (DROPPED.has(tag)) continue;
    const inner = cleaned(child);
    if (!TAGS.has(tag)) out += inner;
    else if (tag === 'br') out += '<br>';
    else if (tag === 'a') {
      const href = linkAddress(child.getAttribute('href'));
      const address = href === null ? '' : ` href="${escape(href).replace(/"/g, '&quot;')}"`;
      out += `<a${address} rel="${REL}">${inner}</a>`;
    } else out += `<${tag}>${inner}</${tag}>`;
  }
  return out;
}

function words(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? '';
    else if (child instanceof Element && !DROPPED.has(child.localName)) {
      const gap = BREAKS.has(child.localName) ? ' ' : '';
      out += gap + words(child) + gap;
    }
  }
  return out;
}

/** The description as the server will store it: only the allowed tags, links http/https. */
export function cleanDescription(html: string): string {
  return descriptionText(html) ? cleaned(parse(html)) : '';
}

/** Its text, tags removed and white space collapsed: what the counter and the limit count. */
export function descriptionText(html: string): string {
  return words(parse(html)).split(/\s+/).filter(Boolean).join(' ');
}

/** A piece of a search hit's description: `hit` where it matches the search term. */
export interface Marked {
  text: string;
  hit: boolean;
}

/** The text split around every match of `term`, ignoring case, for <mark> on the hits. */
export function markTerm(text: string, term: string): Marked[] {
  const needle = term.trim().toLocaleLowerCase('nb');
  if (!needle || !text) return text ? [{ text, hit: false }] : [];
  const haystack = text.toLocaleLowerCase('nb');
  const parts: Marked[] = [];
  let at = 0;
  for (let found = haystack.indexOf(needle); found !== -1; found = haystack.indexOf(needle, at)) {
    if (found > at) parts.push({ text: text.slice(at, found), hit: false });
    parts.push({ text: text.slice(found, found + needle.length), hit: true });
    at = found + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
