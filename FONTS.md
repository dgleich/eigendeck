# Eigendeck Bundled Fonts

Eigendeck ships with a curated set of font packages. Each package pairs a
text font with a matching MathJax math font bundle so slides and equations
render in a consistent typographic voice.

All bundled fonts are open source (SIL Open Font License 1.1). License text
for each is included alongside the font files in `public/fonts/<id>/`.

| ID | Label | License File | Source | Description |
|----|-------|--------------|--------|-------------|
| `ptsans` | PT Sans | [OFL](public/fonts/ptsans/OFL.txt) | [Google Fonts](https://fonts.google.com/specimen/PT+Sans) | Patched PT Sans (serifed I) + Latin Modern Math |
| `libertinus` | Libertinus Serif | [OFL](public/fonts/libertinus/OFL.txt) | [alerque/libertinus](https://github.com/alerque/libertinus) | Classical serif with matching Libertinus Math |
| `libertinus-sans` | Libertinus Sans | [OFL](public/fonts/libertinus-sans/OFL.txt) | [alerque/libertinus](https://github.com/alerque/libertinus) | Sans companion to Libertinus + Libertinus Math |
| `lm-sans` | CMU Sans | [OFL](public/fonts/lm-sans/LICENSE.txt) | [CM Unicode (CTAN)](https://sourceforge.net/projects/cm-unicode/) | CMU Sans Serif + NewCM Sans Math |
| `noto-sans` | Noto Sans | [OFL](public/fonts/noto-sans/OFL.txt) | [Google Noto](https://fonts.google.com/noto) | Google's universal sans + Noto Sans Math |
| `source-sans` | Source Sans | [OFL](public/fonts/source-sans/OFL.txt) | [adobe-fonts/source-sans](https://github.com/adobe-fonts/source-sans) | Adobe's Source Sans 3 + Latin Modern Math |
| `source-code` | Source Code | [OFL](public/fonts/source-code/OFL.txt) | [adobe-fonts/source-code-pro](https://github.com/adobe-fonts/source-code-pro) | Monospace + Latin Modern Math |
| `shantell` | Shantell Sans | [OFL](public/fonts/shantell/OFL.txt) | [Google Fonts](https://fonts.google.com/specimen/Shantell+Sans) | Hand-drawn casual + Shantell math (looks amazing) |
| `concrete-euler` | CMU Concrete + Euler | [OFL](public/fonts/concrete-euler/LICENSE.txt) | CMU Unicode + Euler Math (CTAN) | Concrete Mathematics style (Knuth/Graham/Patashnik) |

## MathJax Math Font Pairings

MathJax bundles are built by [dgleich/mathjax-fonts](https://github.com/dgleich/mathjax-fonts).
Each text font is paired with a math font that visually complements it:

| Text Font | Math Font |
|-----------|-----------|
| PT Sans | Latin Modern Math (Computer Modern operators) |
| Libertinus Serif / Sans | Libertinus Math |
| CMU Sans Serif | NewCM Sans Math |
| Noto Sans | Noto Sans Math |
| Source Sans 3 / Source Code Pro | Latin Modern Math |
| Shantell Sans | Custom (LM Math base, restyled) |
| CMU Concrete | Euler Math |

All math fonts (Latin Modern, Libertinus, NewCM, Noto, Euler) are OFL-licensed.

## How fonts are selected

Eigendeck has three font slots: **title**, **body**, and **hype**.

- **Title preset** uses the title font.
- **Hype preset** uses the hype font.
- **All other presets** (body, textbox, annotation, footnote) use the body font.
- **Footnote** specifically uses the body font's narrow variant if available
  (only PT Sans currently has one).

Resolution priority for each slot:

1. Per-slide override (`slide.titleFont` / `bodyFont` / `hypeFont`)
2. Presentation default (`config.defaultTitleFont` / etc.)
3. Fallback to `'ptsans'`

Math always uses the bundle for the **body font** (constraint of MathJax's
singleton design). Math placed in a title with a different font will render
in body's math font; this is acceptable since math typography conventions
favor the surrounding body context.

## Adding a new font

1. Build the MathJax bundle in [dgleich/mathjax-fonts](https://github.com/dgleich/mathjax-fonts).
2. Add a `FontPackage` entry to `src/lib/fonts.ts`.
3. Add the source font URLs to `scripts/download-fonts.mjs` and run it.
4. Run `npm run setup` to copy the new MathJax bundle into `public/mathjax/`.
5. Update this file (`FONTS.md`).

## Embedded in exports

When you export a presentation to HTML or PDF, only the font packages
*actually used* in that presentation are embedded as base64 data URLs.
A typical presentation embeds 1-3 packages (~3-10 MB of font data total).
