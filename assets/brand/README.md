# skctl brand assets

The mark shows three index cards with the middle card pulled to the right.
The ordered rows represent maintaining Skills; the offset card represents selecting
content to disclose. skctl and its terminal workbench, sktui, share the mark.

## Files

| File                                        | Use                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `logo-light.png`                            | Transparent mark for light backgrounds, 512 × 512                     |
| `logo-dark.png`                             | Transparent mark for dark backgrounds, 512 × 512                      |
| `logo-readme-light.png`                     | Mark on a white background for the README, 512 × 512                  |
| `logo-readme-dark.png`                      | Mark on GitHub's default dark background for the README, 512 × 512    |
| `logo-black.png`                            | Black monochrome mark, transparent, 512 × 512                         |
| `logo-white.png`                            | White monochrome mark, transparent, 512 × 512                         |
| `avatar.png`                                | White mark on blue, 512 × 512, for repository or organization avatars |
| `icon-16.png`, `icon-32.png`, `icon-48.png` | Compact transparent blue marks at their named pixel sizes             |
| `favicon.ico`                               | Browser icon containing the transparent 16, 32 and 48 px marks        |
| `source/generated-mark.png`                 | Original generated image                                              |
| `source/generation-brief.md`                | Approved direction, visual rules and generation prompt                |
| `source/export-metadata.json`               | Generation parameters, crop coordinates and file digests              |

The root README centers the mark, product name, tagline and section links. It
selects an opaque `logo-readme-*` image using `prefers-color-scheme`, so image
previews that discard alpha still show the mark. These backgrounds match GitHub's
default light and dark themes; other themes may show the square canvas. Use the
transparent `logo-light.png` and `logo-dark.png` exports in layouts that composite
alpha correctly. The product name remains text, so readers can select it and
assistive technology can read it.
The avatar is available for manual upload; adding this file does not change a
GitHub account or repository setting. The icons are available for future web
integration; this repository currently ships terminal applications.

## Favicon

A favicon is the small site icon shown in browser tabs and bookmarks. For a
website, copy `favicon.ico` to its public directory and add this to the HTML head:

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
```

The ICO uses only the dark-background palette: `#f3f6fa` cards with the middle
card in `#80b7f5`, on a transparent background. Its three sizes retain the small
icons' silhouettes and alpha channels. It does not switch palettes with the browser
theme. The separate `icon-*.png` files keep their original blue color. Adding a
favicon does not change GitHub's own tab icon or add a web interface to skctl.

## Color and spacing

Colors come from [the terminal theme](../../packages/sktui/src/ui/theme.ts):

- Light-background mark: `#203249`, with the middle card in `#245a98`.
- Dark-background mark: `#f3f6fa`, with the middle card in `#80b7f5`.
- Avatar background: `#245a98`.
- Small icons: `#3565a0`.

The README exports use GitHub canvas colors: `#ffffff` and `#0d1117`.

Preserve the square canvas and its built-in clear space. Scale proportionally.
Use the compact exports at small sizes. Keep the rows separated and preserve
the middle card's offset. The logo carries no shadow, gradient or enclosing border.

## Source and processing

The image was generated on 2026-10-19 with an image generation service and
`gpt-image-2`, high
quality, PNG and a transparent-background request. The generation inputs were
the saved brief and the project's `DESIGN.md`. The request specified 1024 × 1024;
the service returned a 1254 × 1254 PNG with a real alpha channel.

The initial 2-image request returned only 1 image and failed output validation.
A separate single-image request produced the saved source.

FFmpeg crops, cleans near-transparent speckles, normalizes nearly opaque fills,
applies the theme colors and resizes the selected silhouette. It preserves the
generated geometry. The 16-pixel export uses a hard alpha cutoff after reduction
to keep the gaps visible. The avatar uses the same mark on a solid background.
The README variants composite the transparent exports onto their named backgrounds.

These files are raster artwork. The source image and export metadata preserve
the delivered revision. Editable vector artwork and a custom wordmark remain
future design work.
