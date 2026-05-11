# Artist photos (placeholder drop-zone)

Per-artist photos for the public directory + EPK + homepage. Files
here are **gitignored** — drop your local files in, they show up
live after the next `npm run ship`. Replace any time without touching
code.

## Filename rule

Lowercase the artist's `stage_name`, replace spaces with hyphens,
strip all other punctuation:

| Artist | Filename |
|---|---|
| ETCH | `etch.jpg` |
| EPI | `epi.jpg` |
| HIGHLITE | `highlite.jpg` |
| IMEN | `imen.jpg` |
| ASHKAN K | `ashkan-k.jpg` |
| ANTURAGE | `anturage.jpg` |

The slugger is the same on every page that uses these (directory
grid, directory list, EPK hero). Keep filenames consistent.

## Sizes

| Where used | Aspect | Recommended size |
|---|---|---|
| Directory grid card cover | 16:9-ish (rendered ~3:2) | **800×1000 portrait** or 1200×800 landscape |
| Directory list thumbnail | 1:1 square | inherits from same file, cropped |
| EPK hero avatar (`.avatar-xlarge`) | 1:1 square, 160×160 rendered | **800×800 square portrait** |

A single 1200×1200 portrait that crops well to a square works for
everything. If you have a hero shot for a specific artist that wants
a different crop on EPK vs directory, override per-page later.

## Fallback behavior

Every `<img>` in the code uses `onerror="this.remove()"`. If the file
isn't here, the page falls back to the deterministic name-hash
gradient + initials. So:

- **No file → directory shows gradient + initials.** No broken-image
  icon. No layout shift.
- **File present → photo overlays the gradient.** Initials sit behind
  the photo, invisible.

You can mix: drop in `etch.jpg` only, the other 5 stay on gradients.
Add the rest at your own pace.

## Format / compression

JPG strongly preferred — smaller than PNG for photographic content.
WebP or PNG also work but you'd need to edit the page slugger to use
the new extension (currently hard-coded to `.jpg`).

Compress before uploading. Anything over ~250 KB is overkill — these
are below-the-fold thumbnails most of the time. Use ImageOptim, Squoosh,
or `cwebp -q 80`.

## When an artist signs up + uploads their own photo

Once a real artist signs up and uploads their avatar via the artist
profile editor, `profiles.avatar_url` is set and the directory + EPK
pages prefer that over the slug-based file. You can leave the slug
file in place or delete it — the real upload wins.

The migration that seeded these six artists is at
`web/supabase/migrations/20260512_seed_launch_artists.sql`.
