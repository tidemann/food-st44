"""Tags ("emneord"): short lower-case words on a recipe, such as "middag" or "kake" (ST-784).

One rule for what a tag is, used by every write: `normalise`. One order, used by every read:
`sort_key`, Norwegian, so Æ, Ø and Å come after Z.
"""

import unicodedata
from collections.abc import Iterable

# Longer words broke the row rhythm in the list (ST-778, worst case). The form stops at this too.
MAX_CHARS = 24

# After "z" in code-point order, in the Norwegian alphabet's order.
_LAST = str.maketrans({"æ": "{", "ø": "|", "å": "}"})


def _composed(name: str) -> str:
    """NFC: a pasted "å" made of "a" + ring is the same string as a typed "å"."""
    return unicodedata.normalize("NFC", name)


def normalise_one(name: str) -> str:
    """Composed (NFC), trimmed, inner spaces collapsed, lower case, cut to MAX_CHARS.
    "" when nothing is left."""
    return _composed(" ".join(name.split()).lower())[:MAX_CHARS].rstrip()


def normalise(names: Iterable[str]) -> list[str]:
    """Each name normalised; empty ones and repeats dropped, first occurrence kept.
    "Middag " and "middag" are the same tag."""
    seen: dict[str, None] = {}
    for name in names:
        tag = normalise_one(name)
        if tag:
            seen.setdefault(tag, None)
    return list(seen)


def sort_key(name: str) -> str:
    """Norwegian order: Æ, Ø, Å last; other accents sort with their letter ("é" as "e")."""
    decomposed = unicodedata.normalize("NFD", _composed(name.lower()).translate(_LAST))
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def sort_names(names: Iterable[str]) -> list[str]:
    return sorted(names, key=lambda name: (sort_key(name), name))
