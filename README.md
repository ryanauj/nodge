# nodes-plus-edges

Vite + React + TypeScript scaffold with an **aggressive client-side gate**
instead of per-PR CI.

## Develop

```bash
pnpm install   # also wires the git hooks via husky's `prepare`
pnpm dev
```

## Build

```bash
pnpm build
```

## How checks work

The primary gate is a **husky `pre-push` hook** (`.husky/pre-push`) that runs
`pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` and aborts the
push if any step fails. It is installed automatically by `pnpm install` (the
`prepare` script).

> The hook is *technically* bypassable (`git push --no-verify`) because
> client-side hooks are advisory. That escape hatch is for emergencies only.

GitHub Actions does **not** run on pull requests. `.github/workflows/ci.yml`
only re-runs `typecheck` + `lint` + `test` + `build` on pushes to `main`, as a
thin backstop for anything that slipped past the hook.
`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on push to
`main`.
