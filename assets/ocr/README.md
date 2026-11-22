# Local OCR runtime resources

These files make the HUD event detector work fully offline. They are **not**
loaded from a CDN at runtime.

- Tesseract.js `7.0.0` worker + ESM API (Apache-2.0)
- Tesseract.js-core `7.0.0` CPU/SIMD/LSTM/relaxed-SIMD JS+WASM builds (Apache-2.0)
- `eng` and `chi_sim` traineddata `1.0.0`, `4.0.0_best_int` (MIT)
- Full licenses are in `licenses/`; exact file hashes, package tarball URLs and
  license metadata are in `resource-manifest.json`.

Regenerate from the pinned versions and verify every tarball hash:

```sh
node scripts/prepare-ocr-assets.mjs
```

The script downloads only the pinned npm tarballs, checks their SHA-256, and
copies the required files here. The application's runtime sources include
`assets/`, so a future authorized desktop build will include these files in
`app.asar`. Do not replace these paths with CDN URLs.
