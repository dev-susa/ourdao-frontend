# Contract Redeployment: the Frontend's Role (#277)

A Soroban contract is **immutable** — once `ourdao-contracts` is deployed, that
contract can never be changed or undone. "Redeploying" means deploying a *new*
contract (a new `C…` id) and pointing the app at it.

The frontend is a **hard-coded client** of a specific contract build. It has no
ABI discovery, no runtime negotiation, and no way to detect a mismatch. That
makes the frontend's part in a redeployment a deliberate, reviewed step rather
than a configuration change — this document is that checklist, so nobody is
reverse-engineering it while a contract is already live and the app is pointed
at the wrong thing.

## What the frontend is actually coupled to

Not just the contract id. Every one of these is a place a redeploy can break the
app, and most of them fail *silently* — a call that decodes wrongly, an enum
variant that no longer matches, a status label that now points at the wrong
number:

| Coupled to | Where in this repo | What breaks if it drifts |
|---|---|---|
| Contract id | `NEXT_PUBLIC_CONTRACT_ID` → `CONTRACT_ID` in `src/lib/stellar.ts` | Reads and writes hit the wrong (or no) contract; without a valid `C…` the UI degrades to its read-only "not configured" state |
| Entrypoint names + argument order/types | Typed wrappers in `src/lib/dao-client.ts` (`daoRead` / `daoWrite`), ScVal builders in `sc` | Simulation fails at signature time for a real member; a reordered argument can decode into the wrong field |
| Enum variants and their ordering | the generated `ProposalKind` type in `src/lib/generated/dao-bindings.ts`, `MEMBER_STATUS_LABELS`, `PROPOSAL_STATUS_LABELS` in `src/constants/index.ts` | A renamed or reordered variant is decoded as the wrong case — e.g. a "Treasury" proposal shown as a "Loan" one |
| Struct fields | the generated `LoanPolicy` type (arguments are encoded from the contract spec by `encodeArgs()`) and the mappers in `src/lib/dao-mappers.ts` | A `get_loan_policy` that returns fields in a new order populates the wrong policy values, and the UI will happily compute a wrong max loan against them |
| Error codes | `CONTRACT_ERROR_MESSAGES` in `src/lib/contract-errors.ts` | A member signs a transaction that fails and sees "An unexpected contract error occurred" instead of what actually went wrong |
| Event symbols | `EVENT_LABELS` in `src/lib/dao-mappers.ts` (the activity feed) | Real events show as their raw symbol instead of a readable label |
| Token / decimals assumptions | `formatToken` / `parseToken` in `src/lib/utils.ts` (7 decimals, the Stellar asset default), `get_token` in `src/lib/dao-client.ts` | A different token or precision changes every amount on screen — the worst kind of bug here, because nothing errors |
| Network | `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`, and the CSP `connect-src` derived from them in `src/middleware.ts` | Every call fails; also, a mainnet-passphrase change must be reflected in the wallet-network check or writes are blocked as a network mismatch |

`contract/interface.json` records the read/write surface and the
`ourdao-contracts` commit it was verified against (`_last_verified`) — it's the
one file in this repo meant to make the coupling explicit and reviewable.

## The procedure

Work in this order. The point of steps 1–3 is to know whether the frontend even
*needs* to change before the new contract is pointed at in production — a
redeploy that only changes the contract id should be a config change, not a
code change.

1. **Get the new contract id and the `ourdao-contracts` commit it's deployed
   from.** Both are needed for the CHANGELOG.

2. **Regenerate `contract/interface.json` against the new build** and update
   `_last_verified` to the deployed commit:

   ```bash
   stellar contract inspect --wasm <path-to-contract.wasm>
   # then update contract/interface.json, including "_last_verified"
   ```

   Diff the result against the committed file. That diff *is* the frontend
   impact assessment — every changed line is a place to look in the next step.

3. **Work the diff through the coupling table above.** For each changed
   read/write/type, check the corresponding frontend file. In practice this
   means, in `src/lib/dao-client.ts`:
   - the typed wrapper's method name and argument order/types,
   - the `sc.*` builder used for each argument,
   - the `read<T>()` return type (and the mapper that consumes it).

   For each changed `types` entry (e.g. `ProposalKind`, `MemberStatus`), check
   the label maps in `src/constants/index.ts` and the variant handling in
   `src/lib/dao-mappers.ts`. For any new/renumbered error code, add the message
   to `src/lib/contract-errors.ts` (codes are append-only — don't renumber
   existing ones).

4. **Run the local checks against the new contract** with
   `NEXT_PUBLIC_CONTRACT_ID` pointed at the new id:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```

   Then actually exercise the app against the new contract: register, request a
   loan, vote, repay, stake, attach a document, and check the admin log. The
   unit tests mock the client boundary, so **they will pass even if every call
   signature is wrong** — the manual pass is not optional.

5. **Open a PR** that:
   - updates `contract/interface.json` (including `_last_verified`),
   - updates `dao-client.ts` / mappers / constants / error messages as the diff
     requires,
   - updates the `Contracts:` line under `## [Unreleased]` in `CHANGELOG.md` to
     the new commit — it must match `_last_verified`, and a test enforces it
     (`test/changelog.test.ts`),
   - names the deployed contract id and commit in the "Contract interface
     changes" section of the PR description (the template has a field for this),
   - includes tests that fail without the change.

6. **Deploy, then point production at the new contract** by changing
   `NEXT_PUBLIC_CONTRACT_ID` in the hosting dashboard and redeploying. This is a
   build-time value, so the redeploy is mandatory — see
   [DEPLOYMENT.md](DEPLOYMENT.md#build-time-vs-runtime-variables).

7. **Verify in production:** the app loads, the contract id in the sidebar
   matches, one read and one write succeed end-to-end, and the backend
   (`ourdao-backend`) is pointed at the same contract so the loan history,
   notifications, and activity feed describe the new deployment. A frontend on
   contract A and a backend indexing contract B renders a confidently wrong
   view; check the backend's config as part of this step.

8. **If something is wrong**, follow [ROLLBACK.md](ROLLBACK.md). Note the
   asymmetry: reverting the frontend means pointing `NEXT_PUBLIC_CONTRACT_ID`
   back at the *old* contract id (or redeploying the previous build), but the
   new contract's on-chain state is not rolled back by that — and if members
   have already written to it, those writes stand.

## Known gap: nothing detects this in CI

All four CI checks (lint, typecheck, test, build) pass against a stale
`contract/interface.json`, because none of them can see the contract — the
failure surfaces at a member's signature time, not in CI. There's a design note
in `.github/workflows/ci.yml` (the commented-out `contract-abi-check` job,
tracked as #143) for regenerating the artifact in CI and diffing it against the
committed file. Until that exists, the step-2 diff is the only guard that
exists, and it's a human doing it.

## Quick reference

| Question | Answer |
|---|---|
| Do I need a code change, or just a new contract id? | Only a code change if the step-2 interface diff isn't cosmetic (renames, reordered args, changed types) |
| Can I roll a redeployment back? | The frontend build, yes (see [ROLLBACK.md](ROLLBACK.md)). The contract and its state, no — contracts are immutable. |
| Why did the tests pass against a broken contract? | They mock the client boundary; see the known gap above. |
| Where do I record the contract build this app targets? | `_last_verified` in `contract/interface.json` and the `Contracts:` line in `CHANGELOG.md`. |
