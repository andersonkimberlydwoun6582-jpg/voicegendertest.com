# Voice Gender Test

A privacy-first browser tool for exploring the acoustic features of one short voice recording. It reports median pitch, pitch movement, a spectral brightness proxy, and recording quality without uploading audio or assigning a gender identity.

## Local development

```sh
npm install
npm run dev
```

## Quality checks

```sh
npm test
npm run build
```

The site is statically generated with Astro. The interactive analyzer is a small React island, and the audio analysis lives in testable TypeScript modules under `src/lib`.

## Deployment

Cloudflare Pages should use `main` as the production branch, `npm run build` as the build command, and `dist` as the output directory.
