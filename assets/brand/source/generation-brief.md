# skctl logo generation brief

## Approved direction

The user selected direction A, an ordered set of index cards with the middle
card pulled to the right. skctl helps individuals maintain Agent Skills from
multiple sources and explicitly choose which Collections agents discover.

The silhouette represents organizing and selecting content. CLI and TUI share
this identity. The product name is `skctl`, expanded as Skill Control; the
terminal workbench executable is `sktui`.

## Visual DNA

- Quiet, precise terminal workbench for developers.
- Flat, opaque shapes with consistent, modest corner rounding.
- One distinctive offset, generous separation, and a compact square silhouette.
- Existing UI blue tokens include `#245a98`, `#3565a0`, and `#80b7f5`.
- The master is monochrome so its silhouette can be reused on light and dark backgrounds.
- No text inside the generated mark. README renders the product name as real text.

The accompanying DESIGN.md is the existing product design source. Apply its
restrained color and shape language. Its screen layouts and UI component recipes
do not apply to this standalone logo.

## Generation prompt

Create one isolated monochrome logo symbol on a genuinely transparent 1024 by
1024 PNG canvas. This is a small-size brand mark for skctl, an Agent Skill manager.

Draw exactly three separate, solid, flat black horizontal index-card silhouettes,
stacked vertically. Each card has identical width, height, and small corner radius.
The top and bottom cards align at the left. Pull the middle card horizontally
to the right by exactly one card height. Keep two identical horizontal gaps
between the rows. All three cards remain horizontal and parallel.

Use this construction as the target: top card x=128, y=128, width=576, height=192;
middle card x=320, y=416, width=576, height=192; bottom card x=128, y=704,
width=576, height=192. Corner radius approximately 24 pixels. The complete mark
has a 768 by 768 bounding square and equal 128-pixel clear space around it.
Favor clean optical edges and a deliberate small-size silhouette.

Show only this one symbol. Solid black fills, true transparent background,
crisp antialiased edges. No letters, words, captions, checkerboard pattern,
watermark, border, container, mockup, paper texture, folded corners, outlines,
interior lines, connecting strokes, perspective, gradients, shadows, lighting,
bevels, glow, three-dimensional objects, or additional decoration.

## Delivery

Generate raster candidates with gptx. Inspect the actual PNG and its alpha channel.
Select one candidate, preserve its original pixels, then crop and resize for the
README and repository avatar. Color exports preserve the selected alpha mask.
These exports are raster assets; editable vector artwork is a separate future step.
