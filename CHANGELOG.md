# Changelog

Member-visible changes to the OurDAO frontend. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This app is one of three repositories that have to stay compatible, so every
release names the backend and contract builds it was written against:

- **Backend** — the `ourdao-backend` release or commit whose response shapes
  `src/lib/backend.ts` consumes.
- **Contracts** — the `ourdao-contracts` commit recorded in
  `src/lib/generated/dao-bindings.ts` (Source header). Regenerate bindings when updating the contract.

The running build's version is shown at the foot of the app sidebar, so a bug
report can name the entry below it came from. See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog) for when an entry is required and
[docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md) for the release and versioning process.

## [Unreleased]

### Added
- Per-module coverage floors for `dao-client.ts` and `wallet.tsx`, tests for every `daoWrite` entrypoint and the wallet connect/restore/sign flows, and a coverage provider pin matching the installed vitest (#327, #328, #329).
- Playwright end-to-end smoke test suite against mocked Soroban RPC and backend covering load, connect, register, request loan, and vote flows (#374).
- Automated accessibility checks with documented known-issues allow-list for the shell, forms, and main pages at rest (#375).
- Security vulnerability reporting policy in `SECURITY.md` linked from `CONTRIBUTING.md` (#376).
- Documented release and versioning process in `docs/RELEASE_PROCESS.md` (#377).
- The app version and commit are shown at the foot of the sidebar and mobile
  navigation drawer, so a bug report can name the build it came from (#250).
- Build-time feature flags (`NEXT_PUBLIC_FEATURE_FLAGS`, off by default) so a
  risky change can ship disabled; plus a rollback runbook and a contract
  redeployment checklist (#274, #275, #277).

- Connect with xBull, Albedo, LOBSTR, hardware wallets and more through Stellar Wallets Kit ("More wallets" next to Connect Wallet); Freighter stays the default (#344).

### Changed
- Dependency audit: `uuid` is pinned via a `package.json` `overrides` entry inside `jayson`, clearing the `uuid` advisory that arrived with the optional HOT wallet SDK. The findings that remain — `stream-json` (no compatible fixed version; jayson needs its `streamers/StreamValues` subpath) and the rest of the HOT subtree — are allowlisted in `audit-ci.jsonc` with an expiry and a reachability note, and a bundle check asserts that subtree is absent from client chunks (#478).
- Contract method names and argument shapes are now compile-checked against TypeScript bindings generated from the contract wasm (`npm run gen:contract`), and arguments are encoded from the contract spec instead of hand-built. This surfaced and fixes drift: the member join time field is `join_time`, not `join_ledger` (#343).
- Backend stats and loan response types are derived from ourdao-backend's OpenAPI spec (`npm run gen:backend`), and CI fails if the generated file is stale. Two fields are still hand-written until the spec is fixed (#343).
- Upgraded `@stellar/stellar-sdk` to `^17.1.0` and added migration plan and testnet smoke verification checklist (#383).

### Fixed
- The service worker now caches only the offline shell, icons and content-hashed build assets, in a cache named after the build. Member API responses, RSC payloads and cross-origin (IPFS/indexer) responses are no longer stored, so a shared device keeps no member data after disconnect and Cache Storage no longer grows on every navigation; each deploy starts from a fresh cache and deletes the previous one (#479).
- Loan voting deadlines now come from the `voting_period` the contract stored on each proposal instead of a hard-coded fallback, so a proposal created under a different policy period no longer shows (or hides) its vote buttons and "days left" at the wrong time (#477).
- Loan proposals now show their supporting-document indicator on /loans: the contract's `metadata_cid` is mapped to `documentHash` instead of being dropped, so a request created with a document is no longer indistinguishable from one without (#476).
- The dashboard shows one claimable yield amount and one claim button instead of the same pending amount as both "rewards" and "yield" (#345).
- Removed the loan list's Privacy filter, Private stat and purpose search, which could never match anything because loan proposals are public and store no purpose; search now matches borrower address and proposal id, and proposal cards no longer render an empty description (#346).
- Admin add/remove/threshold/pause failures no longer surface as unhandled promise rejections, and the consensus threshold rejects non-integers before signing (#330).
- Disabled misleading loan document encryption and access-permission controls,
  clarified that loan and IPFS data are public, and show the submitted amount
  in the loan review summary (#313).
- Removed the assumed IPFS gateway default and validate gateway URLs and CIDs
  before creating document links (#314).
- Updated private treasury proposal guidance and immediately reflect a
  successful treasury vote in the current member's vote state (#311, #318).

Backend: ourdao-backend unversioned (main; no tagged release to pin yet)
Contracts: ourdao-contracts @ 16e4222

## [0.1.0] - 2026-09-26

`package.json` has sat at 0.1.0 since the project started, so this entry
backfills everything deployed from `main` up to d44e397. Before #161
(2026-08-31) nothing recorded which contract build the app targeted.

Backend: ourdao-backend unversioned (main; no tagged release to pin yet)
Contracts: ourdao-contracts @ 00b0c62

### Added
- Offline handling and a cleaned-up installable PWA manifest (#296).
- A network badge in the header showing which Stellar network the wallet is on (#165).
- Partial loan repayment (#162).
- Proposals awaiting treasury funds, and contract failure events, now appear in
  governance and the activity feed (#175, #176).
- Loan detail page reads the real disbursed loan: status, due date, and
  outstanding balance.
- Admin page built on live contract state: pause/unpause, add/remove admin,
  consensus threshold, and an admin audit log.
- Light and dark themes with a header toggle.
- Per-route page titles and Open Graph/Twitter cards (#7).
- Explorer links for transactions and accounts (#95).

### Changed
- Documents are closed by default and the loan policy is read on-chain
  instead of from constants (#284).
- Maximum loan amount is derived from the treasury balance; the unused
  Cancelled status was dropped (#282).
- Member status labels match the contract enum (#187).
- Proposals are listed newest-first and paginated (#102).
- Backend stats and loan shapes aligned with ourdao-backend (#287).
- Notification panel rebuilt for keyboard focus and Escape handling (#99).
- Freighter version is detected, wallet watching pauses in hidden tabs, and
  signature requests time out instead of hanging (#285).

### Fixed
- Dates are formatted in the member's locale (#291).
- Token amounts display and parse without precision loss (#62, #286).
- Vote controls are disabled once a member has already voted (#118).
- Switching accounts in Freighter no longer shows the previous account's
  data (#98, #286).
- Writes are blocked when Freighter and the app are on different networks.
- Every transaction submission status is handled, not just errors (#129).
- Loan requests keep their purpose, privacy, and document fields (#33).
- Pages refresh after a successful write instead of showing stale data (#32).
- Document uploads use a working IPFS pinning route with gateway fallback
  (#123, #282), cap upload size (#177), and forward permissions (#181).
- Dashboard Recent Activity labels every event instead of "Unknown event occurred".
- Pinch-zoom is allowed (WCAG 1.4.4) (#126), continuous animations honour
  prefers-reduced-motion (#127), and icon-only controls have accessible names (#93).

### Removed
- Fabricated team, testimonial, and statistics content from the landing page.

[Unreleased]: https://github.com/ourdao/ourdao-frontend/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ourdao/ourdao-frontend/tree/d44e397
