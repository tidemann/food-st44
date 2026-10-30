"""The recipe's description ("beskrivelse", ST-1937): a few sentences under the title, with a
little formatting typed as HTML tags.

One rule for what may be stored, used by every write (the site, the MCP tools, an import):
`clean`. It keeps only TAGS, and on a link only an http or https address, and gives the link
rel="noopener nofollow". Everything else goes: scripts and styles with their content, other
tags (images, tables, headings) leaving their text. The length is counted on `text`, the
description without its tags, so formatting costs nothing.
"""

from html.parser import HTMLParser

import nh3

MAX_CHARS = 500
TAGS = frozenset({"b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "a"})
# Tags that end a line: their text is kept apart from the next, so "</p><p>" does not glue
# two words together in the plain text.
_BREAKS = frozenset({"br", "p", "ul", "ol", "li"})

_CLEANER = nh3.Cleaner(
    tags=set(TAGS),
    # "*": no attribute on any tag; without it nh3 keeps "title" and "lang" everywhere.
    attributes={"*": set(), "a": {"href"}},
    url_schemes={"http", "https"},
    # A link to "/oppskrifter/1" or "javascript:" loses its address, and is then only text.
    url_relative="deny",
    link_rel="noopener nofollow",
)


def too_long(over: int) -> str:
    return f"Beskrivelsen kan ikke være lengre enn {MAX_CHARS} tegn. Kort den ned med {over} tegn."


def clean(value: str) -> str:
    """The description as stored: only the allowed tags, trimmed. "" when no text is left."""
    cleaned = _CLEANER.clean(value).strip()
    return cleaned if text(cleaned) else ""


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BREAKS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        self.handle_starttag(tag, [])

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def text(description: str) -> str:
    """The description as plain text, for the list, search and the length: tags removed,
    entities decoded, every run of white space one space. The form counts the same way."""
    parser = _Text()
    parser.feed(description)
    parser.close()
    return " ".join("".join(parser.parts).split())
