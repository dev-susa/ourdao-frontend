<p align="center">
  <img src="public/logo.png" alt="OurDAO logo" width="96" />
</p>

# OurDAO Frontend

[![CI](https://github.com/ourdao/ourdao-frontend/actions/workflows/ci.yml/badge.svg)](https://github.com/ourdao/ourdao-frontend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A [Next.js](https://nextjs.org) web app for the **OurDAO** member-owned lending DAO on **Stellar Soroban**.

- **Wallet:** [Freighter](https://www.freighter.app/) via `@stellar/freighter-api`
- **Chain access:** `@stellar/stellar-sdk` (Soroban RPC — simulate for reads, prepare/sign/submit for writes)
- **Contract:** the [`ourdao-contracts`](https://github.com/ourdao/ourdao-contracts) Soroban DAO
- **Off-chain data:** the [`ourdao-backend`](https://github.com/ourdao/ourdao-backend) indexer/API, for anything the contract itself keeps no queryable history of

This repository is one of three that make up OurDAO:

| Repo | Role |
|---|---|
| [`ourdao-contracts`](https://github.com/ourdao/ourdao-contracts) | The Soroban contract — the single source of truth for all DAO state |
| [`ourdao-backend`](https://github.com/ourdao/ourdao-backend) | Off-chain indexer + read API |
| **`ourdao-frontend`** (this repo) | Next.js web app members actually use |

## Table of contents

- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Routes](#routes)
- [Architecture](#architecture)
- [Where the Stellar integration lives](#where-the-stellar-integration-lives)
- [Contract interface artifact](#contract-interface-artifact)
- [Theming](#theming)
- [Scripts](#scripts)
- [Testing](#testing)
- [What's real vs. not](#whats-real-vs-not)
- [Security notes](#security-notes)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Getting started

```bash
npm install
cp .env.example .env.local   # then edit values (all optional; testnet defaults)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Install the **Freighter** browser extension to connect a wallet.

## Configuration

All config is env-driven with public-testnet defaults (see `.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed OurDAO contract id (`C…`) | _(empty → read-only "not configured")_ |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network passphrase | testnet |
| `NEXT_PUBLIC_IPFS_GATEWAY` | Gateway(s) for reading document content hashes (no credential needed); comma-separate several to fall back in order | Pinata |
| `PINATA_JWT` | **Server-only** Pinata credential for pinning uploaded documents — read by `src/app/api/documents/route.ts`, never exposed to the client | _(empty → uploads fail with a visible error)_ |
| `NEXT_PUBLIC_BACKEND_URL` | [`ourdao-backend`](https://github.com/ourdao/ourdao-backend) indexer/API (loan history, notifications, admin log, events) | _(empty → on-chain-only, no backend)_ — set to `http://localhost:4000` for local dev (see `.env.example`)_ |
| `NEXT_PUBLIC_SITE_URL` | Public site origin, no trailing slash — used as `metadataBase` so Open Graph/Twitter image URLs resolve to an absolute address | `http://localhost:3000` |

Without a `NEXT_PUBLIC_CONTRACT_ID` the UI runs and renders, but on-chain reads/writes are disabled until you point it at a deployed contract. Without a reachable backend, everything backend-derived (loan history, notifications, activity/admin logs) degrades to empty rather than erroring — see `src/lib/backend.ts`. Without `PINATA_JWT`, document uploads fail with a clear error rather than uploading nowhere silently.

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing page — product overview, live DAO stats, wallet connect entry point. |
| `/register` | Join the DAO (pays the membership fee via a real contract call). |
| `/dashboard` | Member home: membership status, voting weight, pending yield, quick actions, DAO-wide stats, recent activity. |
| `/loans` | Browse and vote on loan proposals. |
| `/loans/request` | Multi-step loan request form. |
| `/loans/[id]` | Loan detail — proposal vote state, and once approved, the real disbursed loan's status (Active/Repaid/Defaulted), due date, and a permissionless "Mark as Defaulted" action once overdue. |
| `/governance` | Browse and vote on both loan and treasury proposals in one place. |
| `/governance/create` | Create a treasury withdrawal proposal (optionally private, via commit-reveal). |
| `/treasury` | Treasury balance, staking (stake/unstake for voting-weight boost), claimable yield. |
| `/privacy` | What's actually private on-chain (commit-reveal voting, document encryption) and how to use it. |
| `/admin` | Admin-only: pause/unpause, add/remove admins, set consensus threshold, governance audit log. |

## Architecture

```
src/
  app/
    (app)/        # Shell-wrapped routes (dashboard, loans, governance, treasury,
                  # admin, privacy) sharing (app)/layout.tsx. Route groups are
                  # parenthesised and don't affect the URL.
    register/     # Standalone route, own header (see below)
    page.tsx      # Landing page, at the root, own header (see below)
  components/     # Shared UI: AppShell (header/sidebar), PageHeader (per-page
                  # title/subtitle/actions), ConnectButton, NotificationCenter,
                  # ThemeToggle, DocumentUpload, and the shadcn/ui-derived primitives in ui/
  hooks/          # useDAO.ts (contract reads/writes as React Query hooks),
                  # useNotifications.ts (backend-polled notifications + activity feed),
                  # useNow.ts (a useSyncExternalStore-based clock for countdown displays)
  lib/            # stellar.ts, wallet.tsx, dao-client.ts, backend.ts, ipfs.ts, utils.ts
  types/          # Shared TypeScript types
```

`AppShell` (header + sidebar navigation) is rendered once by `(app)/layout.tsx`, so it persists across navigation within that group instead of remounting per page. Pages under `(app)/` render `<PageHeader title=... subtitle=... actions={...} />` for their own title block — a layout only renders `{children}`, so it can't take page-specific props the way the old per-page `<AppShell>` wrapper did. The landing page and `/register` stay outside the group, with their own standalone headers, since they're meant to work before a user has any DAO context.

Data flows through [TanStack Query](https://tanstack.com/query) throughout: `useDAO.ts`'s hooks wrap live Soroban contract reads (the contract itself has no queryable lists, so proposal/loan enumeration counts come from the indexer, then each item is fetched live by id straight from the contract — the count is an off-chain hint, the data is always on-chain-sourced) and Freighter-signed writes; `useNotifications.ts` wraps the backend's polled REST endpoints.

## Where the Stellar integration lives

| File | Role |
|---|---|
| `src/lib/stellar.ts` | Network config, RPC client, explorer URLs |
| `src/lib/wallet.tsx` | Freighter connect/disconnect/sign context (`useWallet`) |
| `src/lib/dao-client.ts` | Soroban read/invoke + typed wrappers for every contract method |
| `src/components/ConnectButton.tsx` | Freighter connect/disconnect UI |
| `src/hooks/useDAO.ts` | React Query hooks the pages consume |

## Contract interface artifact

The frontend hard-codes argument shapes, enum variants, and event symbols for a specific version of the Soroban contract. `contract/interface.json` pins which version that is by recording the contract's read/write surface alongside the `ourdao-contracts` commit SHA it was verified against.

- **What it is:** A JSON summary of every public entrypoint and enum the contract exposes. It is not the raw WASM or IDL — it is the human-readable shape the frontend depends on.
- **How to regenerate:** After updating the contract, run `stellar contract inspect --wasm <path-to-contract.wasm>` (or the equivalent `soroban contract inspect` output) and update this file.
- **Why it matters:** A contract redeploy that renames a variant or reorders arguments silently breaks the frontend — this file makes the expected surface explicit and reviewable.

## Theming

Light/dark is handled by [`next-themes`](https://github.com/pacocoursey/next-themes) (`ThemeProvider` in `src/components/providers.tsx`, toggled via `src/components/ThemeToggle.tsx` in the header), following the system preference by default and persisting a manual choice in `localStorage`. Colors are Tailwind v4 `@theme` tokens defined in `src/app/globals.css` — a `.dark` class override block flips the semantic set (`background`, `foreground`, `card`, `muted`, `border`, etc.) that `src/components/ui/*` is built against.

Two things worth knowing if you're touching styling:
- Those `ui/` primitives referenced this token set from the start, but the tokens themselves were never actually defined until this was fixed — `bg-card`, `text-muted-foreground`, and friends were silently unstyled before.
- `cn()` (`src/lib/utils.ts`) runs through [`tailwind-merge`](https://github.com/dcastil/tailwind-merge), not just `clsx` — this matters because a component's default variant classes (e.g. `Button`'s default `bg-primary`) and a caller's override classes (e.g. `bg-white`) will otherwise both compile to real CSS rules, and which one wins visually depends on Tailwind's generated stylesheet order rather than which class is written later. `tailwind-merge` resolves that by intent instead.

## Scripts

```bash
npm run dev       # dev server (http://localhost:3000)
npm run build     # production build
npm start         # serve the production build
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm test          # vitest
```

## Testing

Vitest + Testing Library, jsdom by default (pure-logic suites that don't need the DOM, like the Soroban ScVal builders, opt into the Node environment per-file via `// @vitest-environment node`). Coverage: `dao-client.ts`'s ScVal builders and `policyToScVal`, `backend.ts`'s fetch wrappers (including its fail-soft-on-error behavior), `useDAO.ts`'s pure mapping helpers (including `mapLoan`, the real disbursed-loan mapper), `useNotifications.ts`'s hooks, and `useNow.ts`'s `useSyncExternalStore` contract (using fake timers, since the underlying bug it guards against — an infinite render loop — doesn't reproduce reliably just by rendering in jsdom). CI runs lint, typecheck, test, and build on every push/PR — see `.github/workflows/ci.yml`. Two more jobs run alongside, kept separate from those four so an unrelated advisory or a generous, PR-controllable size budget never blocks a PR that has nothing to do with either: a dependency `audit` (see [Dependency hygiene](#security-notes)) that never fails the run (warns instead), and a `bundle-size` check that compares the client JS/CSS shipped from `.next/static` against the latest `main` baseline, only failing on a >5%-and->10 KB gzip regression.

## What's real vs. not

Most of the app is wired to the live contract + backend: registration, loan request/vote/repay, treasury propose/vote, staking, name registry, commit-reveal private voting, document content-hash attachment, notifications, admin actions (pause/unpause, add/remove admin, set consensus threshold), an admin/governance audit log, and loan defaults — `markLoanDefaulted` is exposed in `dao-client.ts`, and the dashboard's Recent Activity feed labels every real event (including `loan_dflt`) instead of a generic placeholder. The loan detail page (`/loans/[id]`) reads the contract's real disbursed `Loan` (via `useLoan`) once a proposal is approved — actual status, due date, and outstanding balance, not proposal-status guesswork that never reflected repayment or default.

**IPFS document storage** (`src/lib/ipfs.ts`) is also real now: AES-GCM encryption happens client-side exactly as before, then the ciphertext is posted to a Next.js route handler (`src/app/api/documents/route.ts`) that pins it to Pinata using a server-only credential (`PINATA_JWT`) — the plaintext and the credential both stay off the client bundle. Downloads read straight from the public gateway (`NEXT_PUBLIC_IPFS_GATEWAY`), no credential needed.

`tsc --noEmit` is fully clean and enforced in CI. `next.config.ts` no longer sets `typescript.ignoreBuildErrors` — `next build` now fails on type errors just like the CI `typecheck` gate (the `eslint.ignoreDuringBuilds` counterpart was removed outright in the Next 16 upgrade — that config key no longer exists).

Running on Next.js 16 (Turbopack by default) + React 19.2.

## Security notes

- **No custody.** The frontend never holds a private key — every signature happens inside the Freighter extension, in the user's own browser context. `src/lib/wallet.tsx` only ever receives a signed transaction XDR back, never a key.
- **Read-only degradation, not silent failure.** Without a configured contract id or a reachable backend, the UI runs in an explicit "not configured" / empty state rather than throwing — see [Configuration](#configuration).
- **Error boundaries.** `error.tsx` (route-segment) and `global-error.tsx` (root-layout-level) catch uncaught render errors and offer a retry instead of the previous behavior, where any single uncaught error anywhere in the tree would take down the entire client-side app with no recovery short of a hard reload.
- **HTTP security headers & CSP.** `next.config.ts` sets `poweredByHeader: false` (no `X-Powered-By`) and a `headers()` function that applies on every response:
  - `Content-Security-Policy` — enforced (not report-only). `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (Next.js hydration needs it — a per-request nonce via middleware would be stricter but isn't achievable with a static `headers()` alone; tradeoff is documented in `next.config.ts`), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, `font-src 'self' data:`, `connect-src 'self'` plus the RPC / backend / IPFS gateway origins derived from the same `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_IPFS_GATEWAY` the app reads at runtime (so non-default deployments don't break), plus `ws:`/`wss:` for HMR, `frame-ancestors 'none'`, `object-src 'none'`, etc. Freighter needs no extra scheme — it injects `window.freighterApi` via the page's JS context and `postMessage`, verified with a real wallet connect/sign/submit flow and no CSP violations in the console across every route.
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin` — prevents the member address in `/loans/[id]` leaking in the `Referer` to external links
  - `X-Frame-Options: DENY` + `frame-ancestors 'none'` (CSP) — no framing, anti-clickjacking for the wallet-connected flow
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  Verified via `curl -I` / external header checker (include output in PR). CSP is the layer that limits what an injected script can load and where it can exfiltrate, even though signing itself stays inside Freighter.
- **Dependency hygiene.** A critical Next.js RCE and several other npm audit findings were patched. `ipfs-http-client` — previously the only dependency with an allowlisted finding — has been removed entirely along with its tree, so its `audit-ci.jsonc` entries are gone too. The rest is enforced automatically rather than tracked by hand: a separate `audit` job in CI (`.github/workflows/ci.yml`) runs `audit-ci` (config: `audit-ci.jsonc`) on every PR at the moderate-and-above threshold, so a new advisory is caught the day it lands instead of at the next manual review. It's a non-blocking job (visible as a warning, doesn't fail the run) since a fresh advisory affects every open PR at once, not just the one that happens to trigger it. Any future allowlist entry is scoped by exact GHSA id with an expiry date, after which it starts failing again until someone deliberately re-reviews and extends it or the dependency is fixed/replaced — see the comments in `audit-ci.jsonc`. One unrelated, unallowlisted finding remains in `nanoid` via `postcss` (pulled in by `next`/`@tailwindcss/postcss`). [Dependabot](.github/dependabot.yml) opens security-update PRs automatically as advisories get patched upstream, and batches routine (non-security) version bumps into a weekly grouped PR so they don't flood the queue — see [CONTRIBUTING.md](./CONTRIBUTING.md)'s note on unrelated dependency bumps.
- **Server-only credentials.** `PINATA_JWT` (document pinning) is read only in `src/app/api/documents/route.ts`, a server-side route handler — never in a `NEXT_PUBLIC_`-prefixed variable, which Next.js would otherwise inline into the client bundle.
- **Privacy claims are audited.** `/privacy` separates what's enforced today from what's designed but not yet delivered (commit-reveal phase separation and commit/reveal UI are still pending in `ourdao-contracts` and this repo; private proposals are currently unvotable and the create form disables that option rather than offering an uncompletable flow). See that page and its tracking links. Once the contract/client fixes land, the page will be updated — noted in the PR so it isn't forgotten.

## Roadmap

- Rework the loan detail page's data model so it derives loan/proposal state more directly (some legacy fields still shadow real on-chain data in places not yet fully migrated).
- Convert `DocumentViewer.tsx`'s manual fetch-in-effect to React Query, matching the rest of the app's data-fetching convention (currently unused in the app, flagged rather than silently left as-is).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, the checks CI enforces, and the frontend-specific rules (no fabricated content, TanStack Query for all data fetching, `cn()` for class composition, both themes verified). Please claim an issue before opening a pull request.

Found a security vulnerability? Don't open a public issue — use GitHub's private vulnerability reporting on this repo.

## License

MIT
