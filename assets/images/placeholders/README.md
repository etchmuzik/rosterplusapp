# Homepage placeholder images

The homepage (`/web/index.html`) references eight images from this
folder. They are all `<img>` tags with `onerror="this.remove()"` — when
the file is missing, the page falls back to gradients + initials, so
the markup is always safe even with this folder empty.

Drop local files at these exact paths to light them up:

| Filename | Used in | Recommended size |
|---|---|---|
| `hero-featured.jpg` | Hero card background (`.lp-mini-bg`) | 1600×1200 (4:3 landscape), atmosphere/lifestyle |
| `featured-avatar.jpg` | Hero card avatar circle (`#lp-featured-photo`) | 800×800 (1:1 square), portrait |
| `gallery-1.jpg` | Feature-01 gallery, tile 1 | 600×600 (1:1 square), portrait |
| `gallery-2.jpg` | Feature-01 gallery, tile 2 | 600×600 |
| `gallery-3.jpg` | Feature-01 gallery, tile 3 | 600×600 |
| `gallery-4.jpg` | Feature-01 gallery, tile 4 | 600×600 |
| `gallery-5.jpg` | Feature-01 gallery, tile 5 | 600×600 |
| `gallery-6.jpg` | Feature-01 gallery, tile 6 | 600×600 |

## Notes

- File extensions matter — the markup hard-codes `.jpg`. If you want PNG
  or WebP, change the `src` in `index.html` to match.
- Gallery tiles are also overwritten by live Supabase data when an
  artist has `avatar_url` set on their `artists` row. The static
  placeholders here are the *fallback* visible before Supabase
  responds and after, when an artist has no avatar uploaded yet.
- Hero card avatar same story — when the featured artist has an
  `avatar_url`, the hydration script in `index.html` swaps the `src`
  to the live URL on page load.
- These files are gitignored (`web/.gitignore` excludes `assets/images/placeholders/*.jpg`)
  so dropping in licensed photos won't accidentally ship them. Only this
  README is tracked. Update `.gitignore` if you want any specific image
  in the repo.
