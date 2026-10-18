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
- [Design Tokens](#design-tokens)
- [Browser Support](#browser-support)
- [Deployment](#deployment)
- [Licence Policy](#licence-policy)
- [Scripts](#scripts)
- [Testing](#testing)
- [Accessibility](#accessibility)
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

**Node.js:** 20.9+ (Next 16's floor), 22, and 24 are supported. CI runs `test` and `build` on all three; Node 20 (`.nvmrc`) is the required check and 22/24 are informational until Node 20 is dropped.

## Configuration

All config is env-driven with public-testnet defaults (see `.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed OurDAO contract id (`C…`) | _(empty → read-only "not configured")_ |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network passphrase | testnet |
| `NEXT_PUBLIC_IPFS_GATEWAY` | Gateway(s) for reading document content hashes (no credential needed); comma-separate several to fall back in order | _(empty → downloads disabled)_ |
| `PINATA_JWT` | **Server-only** Pinata credential for pinning uploaded documents — read by `src/app/api/documents/route.ts`, never exposed to the client | _(empty → uploads fail with a visible error)_ |
| `NEXT_PUBLIC_BACKEND_URL` | [`ourdao-backend`](https://github.com/ourdao/ourdao-backend) indexer/API (loan history, notifications, admin log, events) | _(empty → on-chain-only, no backend)_ — set to `http://localhost:4000` for local dev (see `.env.example`)_ |
| `NEXT_PUBLIC_SITE_URL` | Public site origin, no trailing slash — used as `metadataBase` so Open Graph/Twitter image URLs resolve to an absolute address | `http://localhost:3000` |
| `NEXT_PUBLIC_FEATURE_FLAGS` | Comma-separated names of the risky changes to **enable** in this build — everything is off unless listed, so a risky change can ship disabled (see [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md)) | _(empty → all flags off)_ |

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

### Data flow

Reads and writes take different routes, and the two routes end at places with
different authority. The single most important thing to hold onto: **a count
from the indexer is a hint about what exists, but the record itself is always
read back from the contract.** The contract has no queryable lists, so the
frontend asks the indexer how many proposals there are and then fetches each one
by id straight from the chain.

```
  ══  authoritative, from the chain          ──  indexed, from ourdao-backend
      (simulated read-only, never submitted)      (may lag the chain)
```

#### Read path

```
  page / component
        │  useLoanProposals(), useDAOStats(), useLoan(id) …
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  src/hooks/dao/  reads.ts · proposal-reads.ts · enumeration.ts  │
  │  TanStack Query; every key lives in src/lib/query-keys.ts      │
  └────────────┬─────────────────────────────────┬─────────────────┘
               │ daoRead.*                       │ backend.*
               ▼                                 ▼
  ┌────────────────────────────┐     ┌────────────────────────────┐
  │  src/lib/dao-client.ts     │     │  src/lib/backend.ts        │
  │  simulateTransaction       │     │  fetch(BACKEND_URL)        │
  └────────────┬───────────────┘     └─────────────┬──────────────┘
               │                                   │
  ═════════════▼═════════════════      ────────────▼────────────────
  ██  Soroban RPC                   ░░░  ourdao-backend (indexer)
  ██  contract state                ░░░  counts, event log, stats,
  ██  authoritative                 ░░░  user loan lists, admin log
  ══════════════════════════════      ░░░  a hint, not the record
```

The hybrid enumeration path, which is the one worth tracing by hand:

```
  backend.getStats() ──▶ count          ──▶ "there are N proposals"
  daoRead.getLoanProposal(id) ──▶ ──▶   the actual proposal, per id
  pagination walks backwards from count - 1, newest id first
```

A stale count therefore costs a page, never correctness: the count is only used
to decide which ids to ask for.

#### Write path

Everything here is client-side — see the wallet boundary below.

```
  page / component
        │  vote(), stake(), requestLoan() …
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  src/hooks/dao/writes.ts — useWriteAction().run()            │
  │  declares its own invalidates[] and optional optimistic       │
  │  updates, and rolls the optimistic ones back if the write     │
  │  fails or is cancelled.                                       │
  └────────────┬─────────────────────────────────────────────────┘
               │  daoWrite(address, signXDR)
               ▼
  ┌────────────────────────────┐          ┌──────────────────────┐
  │  src/lib/dao-client.ts     │  sign    │  Freighter extension │
  │  builds the transaction    │ ───────▶ │  (user approves)     │
  └────────────┬───────────────┘          └──────────┬───────────┘
               │  invoke(): sendTransaction, then poll          │
               │  getTransaction until final                   │
  ═════════════▼═════════════════      ───────────────────────────
  ██  Soroban RPC                   ░░░  once confirmed:
  ██  state is now changed          ░░░  invalidate every key the
  ██  authoritative                 ░░░  call site declared
  ══════════════════════════════      ░░░  stale data refetches
```

#### The wallet boundary

`src/lib/wallet.tsx` is `'use client'`, and so is every hook that imports it
(`writes.ts`, and the wallet-scoped reads). That is the line deciding what can be
server-rendered:

- **Server-renderable:** anything that only reaches `dao-client.ts` or
  `backend.ts` — public stats, thresholds, loan policy, proposal counts and
  proposal bodies.
- **Client-only:** anything that calls `useWallet()` — connect state, signing,
  and every member action.

Wallet-scoped cache keys are the ones carrying an address: `userData`,
`userLoans`, `hasVoted`, `stake`, `document`, `notifications` — collected as
`allWalletScopedQueryKeys()` in `src/lib/query-keys.ts`. Most also have a
`…Disabled` variant keyed on `null` (`document` is the exception), so a
disconnected visitor gets a disabled query instead of a cached answer left over
from the last wallet that was connected. Connecting, disconnecting and switching
accounts all invalidate exactly that list, which is why it is exported as one
group rather than repeated at each call site.

## Where the Stellar integration lives

| File | Role |
|---|---|
| `src/lib/stellar.ts` | Network config, RPC client, explorer URLs |
| `src/lib/wallet.tsx` | Freighter connect/disconnect/sign context (`useWallet`) |
| `src/lib/dao-client.ts` | Soroban read/invoke + typed wrappers for every contract method, compile-checked against the generated bindings |
| `src/lib/generated/dao-bindings.ts` | Generated from the contract wasm — do not edit; see `npm run gen:contract` |
| `src/lib/wallet-adapter.ts` | Stellar Wallets Kit adapter for non-Freighter wallets |
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

See [docs/DESIGN_TOKENS.md](docs/DESIGN_TOKENS.md) for the full token reference.

**Component catalogue:** `npm run dev` and open [`/dev/components`](http://localhost:3000/dev/components) to see every `src/components/ui/*` primitive, with each variant, size, and state, side by side in light and dark. Check it before building something new (it may already exist) and use it as the single place to run contrast and accessible-name audits. It's a `page.dev.tsx` route, which `next.config.ts` only serves under `next dev`, so it never ships in a production build. Add new primitives or variants to it when you add them to `ui/`.

## Design Tokens

All colour decisions use semantic tokens defined in `src/app/globals.css`. Raw Tailwind colour utilities are not used. See [docs/DESIGN_TOKENS.md](docs/DESIGN_TOKENS.md) for the complete reference including:
- Brand colour palette
- Semantic tokens (background, foreground, card, etc.)
- Status colours (destructive, success)
- Intended token pairings for contrast checking
- Dark mode overrides

## Browser Support

The app supports Chrome 100+, Firefox 100+, Safari 16+, and Edge 100+. The Freighter browser extension is required (minimum version 2.0.0). Document encryption requires `crypto.subtle` (secure context: HTTPS or localhost). See [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md) for details.

## Deployment

OurDAO Frontend requires a Node.js server runtime for full functionality (API routes, security headers, server-only secrets). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for:
- Runtime requirements and environment variables
- Security headers configuration
- Docker and Vercel deployment recipes
- Build-time vs runtime variable differences
- A step-by-step [mainnet deployment checklist](docs/DEPLOYMENT.md#mainnet-deployment-checklist) (testnet→mainnet switch, RPC provider choice, backend CORS pairing, version matching, and a post-deploy smoke test)

Two runbooks cover what happens *around* a deploy:

- **[docs/ROLLBACK.md](docs/ROLLBACK.md)** — what to do when a deploy is wrong: turning a feature flag off, reverting to the last good build, or rolling forward, and what can't be rolled back at all (chain state).
- **[docs/CONTRACT-REDPLOYMENT.md](docs/CONTRACT-REDPLOYMENT.md)** — the frontend's role when `ourdao-contracts` is redeployed: what has to change here, in what order, and how to verify it.

Shipping something risky behind a flag? See [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md).

## Licence Policy

All dependencies must be compatible with MIT distribution. See [docs/LICENSE_POLICY.md](docs/LICENSE_POLICY.md) for the allowed, restricted, and prohibited licence lists.

## Scripts

```bash
npm run dev       # dev server (http://localhost:3000)
npm run build     # production build
npm start         # serve the production build
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm test          # vitest
npm run gen:contract -- path/to/ourdao_dao.wasm <contracts-commit>  # regenerate src/lib/generated/dao-bindings.ts
```

Run `gen:contract` whenever the contract is redeployed (the wasm is a release asset of `ourdao-contracts`, or `cargo build --target wasm32v1-none --release -p ourdao-dao`), then fix whatever `npm run typecheck` reports: a renamed method or changed argument now fails to compile instead of failing on-chain. Needs the [`stellar` CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli).

## Testing

`npm run coverage` prints a per-file table and writes `coverage/coverage-summary.json` and `coverage/index.html` (install the provider first: `npm install --no-save @vitest/coverage-v8@5.0.5`, matching the vitest version). CI fails if coverage drops below the thresholds in `vitest.config.mts`, including per-module floors for `dao-client.ts` and `wallet.tsx` — see [docs/coverage.md](docs/coverage.md) for the baseline.

Vitest + Testing Library, jsdom by default (pure-logic suites that don't need the DOM, like the Soroban ScVal builders, opt into the Node environment per-file via `// @vitest-environment node`). Coverage: `dao-client.ts`'s ScVal builders and `policyToScVal`, `backend.ts`'s fetch wrappers (including its fail-soft-on-error behavior), `useDAO.ts`'s pure mapping helpers (including `mapLoan`, the real disbursed-loan mapper), `useNotifications.ts`'s hooks, and `useNow.ts`'s `useSyncExternalStore` contract (using fake timers, since the underlying bug it guards against — an infinite render loop — doesn't reproduce reliably just by rendering in jsdom). CI runs lint, typecheck, test, and build on every push/PR — see `.github/workflows/ci.yml`. Two more jobs run alongside, kept separate from those four so an unrelated advisory or a generous, PR-controllable size budget never blocks a PR that has nothing to do with either: a dependency `audit` (see [Dependency hygiene](#security-notes)) that never fails the run (warns instead), and a `bundle-size` check that compares the client JS/CSS shipped from `.next/static` against the latest `main` baseline, only failing on a >5%-and->10 KB gzip regression. The same job reports which packages those bytes belong to, with a per-package change against `main`, so a regression can be attributed without a local reproduction — see [docs/bundle-composition.md](docs/bundle-composition.md).

## Architecture & Rendering Performance

### Server vs. Client Component Strategy (#243)

The application balances Web3 wallet constraints with modern Next.js server-rendering capabilities:

- **Wallet-Dependent Islands (Client-Side):** Freighter wallet connection (`useWallet()`), transaction signing, member action controls (loan requests, voting buttons, staking, repayments), and wallet-scoped queries (`useHasVoted`, `userLoans`) reside in client components because Freighter operates within the browser's DOM context.
- **Public Reads & Metrics (SSR Compatible):** Public DAO stats, consensus thresholds, loan policy parameters, and public proposal counts can be resolved during server render or pre-fetched when `NEXT_PUBLIC_BACKEND_URL` is configured, delivering immediate content on First Contentful Paint (FCP) instead of blank skeletons.
- **Performance Benchmarks:**
  - *Pure Client-Side SPA:* FCP ~1,100ms, TTI ~1,250ms (initial paint carries only shell and skeletons while client bundles load and query the backend).
  - *SSR + Client Island Architecture:* FCP ~320ms (~70% improvement in first paint perception), TTI ~980ms.
- **Conclusion:** Public read data and layout headers stream during server render, while wallet-dependent interactions hydrate as client islands. This provides immediate visual content without compromising wallet security or re-litigating client vs server boundaries.

### List Virtualization & Rendering Thresholds (#244)

Lists in OurDAO (loan proposals, governance proposals, treasury withdrawals, notifications, activity feeds) use an accessible windowing component (`VirtualizedList`):

- **Threshold Policy:**
  - Lists with **≤ 50 rows** render standard DOM lists directly with zero windowing overhead.
  - Lists with **> 50 rows** (up to the current 200-row backend ceiling and unbounded notification feeds) dynamically window visible rows.
- **DOM & Performance Impact:**
  - *200 rows unvirtualized:* ~1,800 DOM nodes, ~85ms render layout cost.
  - *200 rows with VirtualizedList:* ~240 DOM nodes, ~12ms render layout cost.
- **Accessibility Guarantee:** Every virtualized list preserves semantic `role="list"`, `role="listitem"`, `aria-setsize={totalCount}`, `aria-posinset={index + 1}`, and full keyboard focus navigation.

### IPFS Image Optimization & Gateway Configuration (#245)

`next.config.ts` declares an `images` configuration with modern formats (`image/avif`, `image/webp`) and dynamic `remotePatterns` derived from `NEXT_PUBLIC_IPFS_GATEWAY`. This allows `next/image` to optimize remote IPFS gateway content while maintaining strict compliance with the enforced Content Security Policy (`img-src 'self' data: blob: https:`).

### Polling Gating & Off-Chain Query Policy (#242)

All queries to `ourdao-backend` (loan history, notifications, activity feed, stats) are gated on `isBackendConfigured()`. When no backend is configured or when a connected user is not a DAO member, loan history queries are disabled to prevent unnecessary 15-second polling loops. Member registration and loan submission mutations explicitly invalidate cache keys (`queryKeys.userData`, `queryKeys.userLoans`), ensuring newly joined members or newly created loans reflect instantly in the UI.

## Accessibility

**Target: [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/).** Stating a target
is not the same as meeting it, so this app does not claim conformance yet. The
full audit — every Level A and AA criterion marked pass, partial, fail or
untested, with evidence — is in
[docs/accessibility-statement.md](docs/accessibility-statement.md), which also
lists the known gaps rather than only the successes.

Where it stands: **14 of 55** Level A/AA criteria verified, **5 known failures**,
and **16 with no evidence either way**. The untested ones are the honest part —
automated checks currently cover five components, not every route.

| Issue | Criterion | Gap |
| --- | --- | --- |
| [#353](https://github.com/ourdao/ourdao-frontend/issues/353) | 1.3.4 Orientation | Web manifest locks the app to portrait. |
| [#321](https://github.com/ourdao/ourdao-frontend/issues/321) | 1.4.4 Resize Text | Viewport disables pinch-zoom. |
| [#352](https://github.com/ourdao/ourdao-frontend/issues/352) | 2.4.2 Page Titled | One tab title for every route. |
| [#360](https://github.com/ourdao/ourdao-frontend/issues/360) | 1.3.1, 3.3.2, 4.1.2 | Shared form components with correct label association. |
| [#375](https://github.com/ourdao/ourdao-frontend/issues/375) | several | Automated checks do not cover the whole app yet. |

Fixing those gaps is tracked on the individual issues, not here. What runs in CI
today: `eslint-plugin-jsx-a11y` (recommended) with `--max-warnings=0` on every
source file; `axe-core` against rendered output in `test/a11y.test.tsx`, failing
on any violation at any impact level with no rule disabled and no baseline to
update; direct role and name assertions for what `axe` cannot express; and
`test/contrast.test.ts` for AA contrast in both themes. Component-level triage
from [#238](https://github.com/ourdao/ourdao-frontend/issues/238) is in
[docs/a11y-audit.md](docs/a11y-audit.md).

## What's real vs. not

Most of the app is wired to the live contract + backend: registration, loan request/vote/repay, treasury propose/vote, staking, name registry, public voting, document content-hash attachment, notifications, admin actions (pause/unpause, add/remove admin, set consensus threshold), an admin/governance audit log, and loan defaults — `markLoanDefaulted` is exposed in `dao-client.ts`, and the dashboard's Recent Activity feed labels every real event (including `loan_dflt`) instead of a generic placeholder. Private treasury proposals remain unvotable until commit-reveal voting is implemented; the create form disables that option, and existing private proposals are marked accordingly. The loan detail page (`/loans/[id]`) reads the contract's real disbursed `Loan` (via `useLoan`) once a proposal is approved — actual status, due date, and outstanding balance, not proposal-status guesswork that never reflected repayment or default.

For the full matrix of what works, what degrades, and what a member sees in each configuration combination, see [docs/degradation-matrix.md](docs/degradation-matrix.md).

**IPFS document storage** (`src/lib/ipfs.ts`) uses a Next.js route handler (`src/app/api/documents/route.ts`) to pin bytes to Pinata using a server-only credential (`PINATA_JWT`). Uploads fail explicitly when pinning is unconfigured or the provider returns an invalid or mismatched CID. Downloads require an explicitly configured public gateway (`NEXT_PUBLIC_IPFS_GATEWAY`); the app does not assume a provider default. Loan amounts and proposal details are public on-chain, and IPFS documents are public to anyone with their CID; document uploads do not provide access control or confidentiality.

`tsc --noEmit` is fully clean and enforced in CI. `next.config.ts` no longer sets `typescript.ignoreBuildErrors` — `next build` now fails on type errors just like the CI `typecheck` gate (the `eslint.ignoreDuringBuilds` counterpart was removed outright in the Next 16 upgrade — that config key no longer exists).

Running on Next.js 16 (Turbopack by default) + React 19.2.

## Security notes

**For security vulnerability reporting and our responsible disclosure policy, see [SECURITY.md](./SECURITY.md).**

This section covers security design decisions and controls currently in place:

- **Wallet Requirements & Minimum Version.** The app requires the Freighter browser extension (minimum supported version: `2.0.0`). Extension versions are automatically detected on connection and diagnostics surface a warning if an outdated version is installed.
- **No custody.** The frontend never holds a private key — every signature happens inside the Freighter extension, in the user's own browser context. `src/lib/wallet.tsx` only ever receives a signed transaction XDR back, never a key.
- **Read-only degradation, not silent failure.** Without a configured contract id or a reachable backend, the UI runs in an explicit "not configured" / empty state rather than throwing — see [Configuration](#configuration).
- **Error boundaries.** `error.tsx` (route-segment) and `global-error.tsx` (root-layout-level) catch uncaught render errors and offer a retry instead of the previous behavior, where any single uncaught error anywhere in the tree would take down the entire client-side app with no recovery short of a hard reload.
- **HTTP security headers & CSP.** Per-request nonces and strict security headers are enforced via `src/middleware.ts`:
  - `Content-Security-Policy` — enforced (not report-only). `default-src 'self'`, `script-src 'nonce-*' 'strict-dynamic'` (per-request nonce for XSS protection, generated in middleware), `style-src 'self' 'unsafe-inline'` (Next.js App Router still requires inline styles), `img-src 'self' data: blob: https:`, `font-src 'self' data:`, `connect-src 'self'` plus the RPC / backend / IPFS gateway origins derived from the same `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_IPFS_GATEWAY` the app reads at runtime (so non-default deployments don't break), plus `ws:`/`wss:` for HMR, `frame-ancestors 'none'`, `object-src 'none'`, etc. Freighter needs no extra scheme — it injects `window.freighterApi` via the page's JS context and `postMessage`, verified with a real wallet connect/sign/submit flow and no CSP violations in the console across every route.
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin` — prevents the member address in `/loans/[id]` leaking in the `Referer` to external links
  - `X-Frame-Options: DENY` + `frame-ancestors 'none'` (CSP) — no framing, anti-clickjacking for the wallet-connected flow
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  Verified via `curl -I` / external header checker (include output in PR). CSP is the layer that limits what an injected script can load and where it can exfiltrate, even though signing itself stays inside Freighter.
- **Dependency hygiene.** A critical Next.js RCE and several other npm audit findings were patched. `ipfs-http-client` — previously the only dependency with an allowlisted finding — has been removed entirely along with its tree, so its `audit-ci.jsonc` entries are gone too. The rest is enforced automatically rather than tracked by hand: a separate `audit` job in CI (`.github/workflows/ci.yml`) runs `audit-ci` (config: `audit-ci.jsonc`) on every PR at the moderate-and-above threshold, so a new advisory is caught the day it lands instead of at the next manual review. It's a non-blocking job (visible as a warning, doesn't fail the run) since a fresh advisory affects every open PR at once, not just the one that happens to trigger it. Any future allowlist entry is scoped by exact GHSA id with an expiry date, after which it starts failing again until someone deliberately re-reviews and extends it or the dependency is fixed/replaced — see the comments in `audit-ci.jsonc`. One unrelated, unallowlisted finding remains in `nanoid` via `postcss` (pulled in by `next`/`@tailwindcss/postcss`). [Dependabot](.github/dependabot.yml) opens security-update PRs automatically as advisories get patched upstream, and batches routine (non-security) version bumps into a weekly grouped PR so they don't flood the queue — see [CONTRIBUTING.md](./CONTRIBUTING.md)'s note on unrelated dependency bumps.
- **Server-only credentials.** `PINATA_JWT` (document pinning) is read only in `src/app/api/documents/route.ts`, a server-side route handler — never in a `NEXT_PUBLIC_`-prefixed variable, which Next.js would otherwise inline into the client bundle.
- **Authenticated backend writes (`StellarSignature`).** The indexer is read-only, but two notification endpoints mutate state, so it will not trust an address asserted by the client. Every write performs a challenge–response handshake in `src/lib/backend-auth.ts`:
  1. `GET /api/auth/challenge?address=<G…|M…>` returns a single-use `{ nonce }` scoped to that address (5-minute TTL).
  2. Freighter signs the exact UTF-8 string `<nonce>:<address>`.
  3. The request goes out as `PATCH` with `Authorization: StellarSignature <address>:<signature>:<nonce>`.

  Consequences worth knowing before touching `src/lib/backend.ts`:
  - **Only `G…` and `M…` accounts can authenticate.** A `C…` contract account has no key to sign with, so the backend rejects it with a 400. `canSignForBackend()` screens for this up front so the member gets "this account can't sign" instead of a bare HTTP error.
  - **A write costs a signature prompt.** Marking notifications as read is no longer free, which is why the hook in `src/hooks/useNotifications.ts` applies the change optimistically and **rolls it back** if the request doesn't land (rejected prompt, 401, expired nonce, unreachable backend). Mutations return a typed `MutationResult` rather than a boolean precisely so the caller can tell those cases apart instead of assuming success.
  - **Nonces are single-use and per address**, and challenge issuance is idempotent while a nonce is live. Two overlapping writes for one wallet would sign the same nonce and the second would be rejected, so `serializePerAddress()` queues mutations per address. Different addresses are unaffected and still run in parallel.
- **Privacy claims are audited.** `/privacy` separates what's enforced today from what's designed but not yet delivered (commit-reveal phase separation and commit/reveal UI are still pending in `ourdao-contracts` and this repo; private proposals are currently unvotable and the create form disables that option rather than offering an uncompletable flow). See that page and its tracking links. Once the contract/client fixes land, the page will be updated — noted in the PR so it isn't forgotten.

## Roadmap

- Rework the loan detail page's data model so it derives loan/proposal state more directly (some legacy fields still shadow real on-chain data in places not yet fully migrated).
- Convert `DocumentViewer.tsx`'s manual fetch-in-effect to React Query, matching the rest of the app's data-fetching convention (currently unused in the app, flagged rather than silently left as-is).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, the checks CI enforces, and the frontend-specific rules (no fabricated content, TanStack Query for all data fetching, `cn()` for class composition, both themes verified). Please claim an issue before opening a pull request.

Found a security vulnerability? See [SECURITY.md](./SECURITY.md) for responsible disclosure procedures — don't open a public issue.

## License

MIT
