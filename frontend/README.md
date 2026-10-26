# TubeArchivist Frontend React

`index.html` builds modern UI from `src/new/main.tsx`. Classic UI is removed;
`/old` and `/old/*` return 404. `/new/*` bookmarks redirect to root routes.

- `src/new/`: pages, components, routes, styles and theme controls.
- `src/api/`: shared backend loaders, actions and API contracts.
- `src/pages/` and `src/components/`: retained API type declarations only;
  existing shared imports keep their paths.
- `src/configuration/`, `src/functions/`, `src/stores/`: shared configuration,
  helpers and state.
- `public/img/default-*`: frontend fallback and backend thumbnail placeholders.

Checks (existing npm toolchain):

```sh
npm run build
node --test tests/*.mjs
npm run lint
```

`tests/classic-buttons.mjs` retired with classic markup and styles. Modern
button accessibility/action coverage remains in `tests/new-buttons.mjs` and
`tests/new-download-contract.mjs`. Rolling-window handler coverage now mounts
modern channel customization in `tests/channel-rolling-window.mjs`.
