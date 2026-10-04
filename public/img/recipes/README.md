# Recipe photographs

The front page and the recipe page show a photograph when one exists for that
recipe, and a reserved plate — tinted paper with a crimson rule — when one does
not. Nothing in the database points at an image; the file name is the link.

## Adding a photograph

Name the file after the recipe title, lowercased, with `æ ø å` written out as
`ae o a` and everything else turned into hyphens:

| Recipe title              | File name                       |
| ------------------------- | ------------------------------- |
| Fårikål                   | `farikal.jpg`                   |
| Kjøttkaker i brun saus    | `kjottkaker-i-brun-saus.jpg`    |
| Rømmegrøt                 | `rommegrot.jpg`                 |
| Smørbrød med reker!       | `smorbrod-med-reker.jpg`        |

Drop the file in this directory and deploy. `.jpg`, `.jpeg`, `.png` and `.webp`
all work. The list is read once when the app starts, so a new photo appears
after the container restarts — which a deploy does anyway.

Keep them around 1400 px on the long edge and under ~150 kB. They are cropped
to fill, so put the dish in the middle and leave room at the edges.

Renaming a recipe changes the file name it looks for. Rename the photo to match,
or the recipe falls back to the reserved plate.

## About the photographs that are here now

These eight are CC0 / free-for-commercial-use stand-ins carried over from the
design directions on [ST-265], chosen so the layout could be judged with real
food in it. Two of them — `lapskaus.jpg` and `fiskegrateng.jpg` — are
approximations of the dish rather than the dish itself.

They are meant to be replaced by Stig's own photographs. Replacing one is a
single file swap; nothing else in the app needs to change.

[ST-265]: https://paperclip.st44.no/ST/issues/ST-265
