# food.st44.no — the Norwegian label set and the accessibility checklist

Appendix to [`DESIGN-GUIDE.md`](DESIGN-GUIDE.md). The guide's §3.3 and §5 point here.

Both lists were written by Ida as §6 and §7 of the *Style guide — food.st44.no MVP* on ST-233,
for the v1 Express site. They are reproduced here because the point of ST-745 is that a person
designing or building a screen should not have to open a Paperclip task to find the rules. This
file is now the copy that is kept current; ST-233 is history.

The rest of that style guide did **not** move here:

- Its §1–§4 (tokens, type, spacing, global rules) are superseded by §4 of the guide, which
  describes the tokens as they actually exist in `v2/frontend/src/styles.css`.
- Its §5 component specs (`.btn`, `.field`, `.recipe-card`, `.app-header` …) describe v1 class
  names. The Angular components carry their own CSS next to them; read those.
- Its §8 "Definition of done for a UI PR" rested on ADR 0001 ("no build step, no client-side
  framework"), which ADR 0002 reversed. §6 of the guide is the current hand-in list, and
  `AGENTS.md` is what CI enforces.

---

## 1. Norwegian UI text (bokmål) — the full label set

Copy from here; do not re-translate per screen. Plain language, informal `dere`, no exclamation
marks.

**Navigation / titles**

| Context | Text |
|---|---|
| List page title | Oppskrifter |
| New page title | Ny oppskrift |
| Edit page title | Rediger oppskrift |
| Back to list | ← Oppskrifter |
| Back to recipe | ← Tilbake til oppskriften |
| Browser `<title>` | `Oppskrifter — food.st44.no` · `«Tittel» — food.st44.no` · `Feil — Ny oppskrift` on a 400 |

**Actions**

| Action | Label |
|---|---|
| Add | + Ny oppskrift |
| Add, from empty state | + Legg til den første oppskriften |
| Save new | Lagre oppskrift |
| Save edit | Lagre endringer |
| Cancel | Avbryt |
| Edit | Rediger |
| Delete (opens confirm) | Slett |
| Delete (confirm page) | Slett oppskriften |
| Search submit | Søk |
| Clear search | Tøm søk |
| Show everything | Vis alle oppskrifter |
| Retry | Prøv på nytt |
| Submitting | Lagrer… |

**Fields**

| Field | Label | Hint |
|---|---|---|
| Title | Tittel | — |
| Ingredients | Ingredienser | Én ingrediens per linje. |
| Instructions | Fremgangsmåte (valgfritt) | — |
| Search | Søk etter oppskrift | — |

**Status, empty and error copy**

| Situation | Text |
|---|---|
| Count, unfiltered | `12 oppskrifter` (`1 oppskrift` in singular) |
| Count, filtered | `3 treff på «fiske»` (`1 treff på «fiske»`) |
| Saved | Oppskriften ble lagret. |
| Updated | Endringene ble lagret. |
| Deleted | Oppskriften ble slettet. |
| No recipes at all | **Ingen oppskrifter ennå** / Legg inn den første, så finner dere den igjen her. |
| No search hits | **Ingen treff på «fiske»** / Prøv et kortere søk, eller se alle oppskriftene. |
| Validation summary | **Oppskriften ble ikke lagret** |
| Title missing | Tittelen må fylles ut. |
| Ingredients missing | Skriv inn minst én ingrediens. |
| List load failed | **Kunne ikke hente oppskriftene.** Prøv igjen om litt. |
| 404 | **Fant ikke oppskriften** / Den kan ha blitt slettet, eller lenken er feil. |
| 500 | **Noe gikk galt** / Prøv igjen om litt. |
| Delete confirm | **Slett «Fiskegrateng»?** / Oppskriften blir borte for godt. Dette kan ikke angres. |
| Meta line | `9 ingredienser · 2. okt` — `nb-NO` date format, lowercase month |

Singular/plural matters: `1 oppskrift` / `12 oppskrifter`, `1 ingrediens` / `9 ingredienser`,
`1 treff` / `3 treff` (treff is invariant).

### 1.1 Where the built site has moved on

The table above is the set as signed off. Søndag and the Angular rewrite changed these, on
purpose; the built string wins, because it is what a reader sees:

| In the table | On the site today | Why |
|---|---|---|
| Count, unfiltered: `12 oppskrifter` | `12 oppskrifter i samlingen`, in the masthead nav band | The count moved into the masthead, where it needs to say *what* it counts. See the guide §3.1 — it counts the collection, never the query. |
| Search field label: `Søk etter oppskrift` | `Søk` | Søndag sets the search as a ruled line with the label above it; the short label is what the picture shows. |
| Back to list: `← Oppskrifter` | breadcrumb `Oppskrifter / «Tittel»`, no arrow | Søndag's recipe page is an article with a breadcrumb, not a page with a back button. The link is crimson (guide §1). |
| Add: `+ Ny oppskrift` | `Ny oppskrift`, no plus | Plain text links in the nav rule; no icons or glyphs in Søndag's chrome. |
| Add, from empty state: `+ Legg til den første oppskriften` | `Legg til den første oppskriften`, no plus | Same reason. |
| Ingredients hint: `Én ingrediens per linje.` | `Én ingrediens per linje. Mengden først: «600 g kjøttdeig».` | The amount is parsed into its own column (guide §2), so the form has to ask for it in that order. |
| `<title>`: `Oppskrifter — food.st44.no` | front page `food.st44.no — familiens oppskrifter`; search `Søk: «term» — food.st44.no`; recipe `«Tittel» — food.st44.no`; delete `Slett «Tittel»? — food.st44.no`; 500 `Noe gikk galt — food.st44.no` | The MVP never had search or a delete page as their own routes. |

**Screens built after ST-233 are not covered by the table.** Sign-in (`Logg inn`, `Logg ut`,
**Ingen tilgang**), the read-only variant of the empty state (*Når husstanden legger inn
oppskrifter, finner du dem her.*), the photo field, and the two import routes (`Lim inn tekst`,
import from a link, recipe from a photo) carry their own Norwegian copy in their templates. It
holds to the same rules — bokmål, informal `dere`, no exclamation marks, no English — but it has
not been through a copy review as one set. If you touch those screens, read the template; if you
add a label that other screens will want, add it here.

---

## 2. Accessibility checklist (WCAG 2.1 AA, POUR)

A builder should be able to tick every line before opening a PR. Everything on this list is
honoured by the built site today **except the 44 × 44 px target in two places**, and that line
is stricter than the heading: 44 × 44 is AAA (2.5.5), while AA asks 24 × 24 (2.5.8, WCAG 2.2).
Buttons and the search field carry `--tap`. The chrome's three small text links are set as type
on a rule, not as buttons, and they do not stand alike (measured in Chromium at 1280 and 390 px):

- **Nav band** (19–26.5 px high; `Logg ut` is the low end, a `<button>` does not inherit the
  body line-height) stands alone in a flex row, so 2.5.8's inline exception does not reach it. Closed by ST-748: a transparent `--tap`-tall `::after`, out of flow and
  centred on each label, gives every link a 44 px hit box without moving the type.
- **Breadcrumb** (`.crumb a`, 15 px) sits in a line of text — `/ {tittel}` follows it — so it
  is exempt from AA 2.5.8 as inline. It is below the AAA 44 px house rule.
- **`Tøm søk`** (`.clear a`, 14 px) is the only content of its own `<p>`, so it is not exempt.
  An invisible band gives it a 24 × 24 hit box (AA). It stops at 24, because a 44 px band
  reaches into the first hit card below.

A failure in any other line is a regression, not a backlog item. What is left of the 44 × 44
line is a known gap, and it is closed by growing the invisible hit area, never the type.

- [ ] `<html lang="no">` on every page.
- [ ] One `<h1>` per page; heading levels never skip.
- [ ] `<header>` and `<main>` landmarks on every page, and `role="search"` on the search form.
      (In v2 the masthead is global and the form is absent when the collection is empty — there
      is nothing to search. The line read "on every template" when every template carried its
      own header.)
- [ ] Every input has a visible or visually-hidden `<label for>`.
- [ ] Every interactive target ≥ 44 × 44 px (`--tap`) — see the note above. The nav band meets
      it with an invisible band; the breadcrumb and `Tøm søk` are the two open cases, and
      neither is fixed by growing the type.
- [ ] Focus visible on every link, button and input — `2px solid var(--red)` at `3px` offset,
      set once in `styles.css`, never removed.
- [ ] Full keyboard path: list → search → card → detail → Rediger / Slett → confirm → back. Tab
      order follows reading order; on the page itself that is skip link → search → nav → content.
- [ ] Errors: `role="alert"`, focused summary, `aria-invalid`, `aria-describedby`, and never
      signalled by colour alone.
- [ ] Flash messages use `role="status"` and do not auto-dismiss.
- [ ] Text contrast ≥ 4.5:1, control boundaries ≥ 3:1 — the measured figures are in the guide §5.
- [ ] `prefers-reduced-motion` respected.
- [ ] Zoom to 200 % without horizontal scrolling or clipped content.
- [ ] Decorative icons `aria-hidden="true"`; no meaning carried by an icon alone.

**Fix a contrast failure inside the look, not by removing it.** Allowed: a different text
colour or tone, a weight, a size, a darker shade of the same hue on a small area. Not allowed:
desaturating, lightening or replacing crimson, or going grey. See the guide §5.
