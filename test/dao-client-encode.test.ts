// @vitest-environment node
//
// jsdom's crypto polyfill isn't compatible with @noble/ed25519's random-byte
// generation (used by Keypair.random()), so this pure-logic suite (no DOM
// interaction) opts back into the real Node environment.
import { describe, expect, it } from 'vitest'
import { Keypair, scValToNative } from '@stellar/stellar-sdk'
import { encodeArgs, type LoanPolicy } from '@/lib/dao-client'

const ADDR = Keypair.random().publicKey()

describe('encodeArgs (spec-driven ScVal encoding)', () => {
  it('encodes addresses and i128 amounts in the contract argument order', () => {
    const [member, amount] = encodeArgs('stake', { member: ADDR, amount: BigInt(1_000_000_000_000) })
    expect(scValToNative(member)).toBe(ADDR)
    expect(scValToNative(amount)).toBe(BigInt(1_000_000_000_000))
    expect(amount.type).toBe('scvI128')
  })

  it('encodes u32 ids and bools', () => {
    const [voter, id, support] = encodeArgs('vote_on_loan_proposal', {
      voter: ADDR,
      proposal_id: 7,
      support: true,
    })
    expect(scValToNative(voter)).toBe(ADDR)
    expect(id.type).toBe('scvU32')
    expect(scValToNative(id)).toBe(7)
    expect(scValToNative(support)).toBe(true)
  })

  it('encodes strings', () => {
    const [owner, name] = encodeArgs('register_name', { owner: ADDR, name: 'alice.our' })
    expect(scValToNative(owner)).toBe(ADDR)
    expect(scValToNative(name)).toBe('alice.our')
  })

  it('encodes bytes', () => {
    const [, , , hash] = encodeArgs('attach_document', {
      caller: ADDR,
      kind: { tag: 'Loan', values: undefined },
      proposal_id: 1,
      content_hash: Buffer.alloc(32, 255),
    })
    expect(Array.from(scValToNative(hash) as Buffer)).toEqual(Array(32).fill(255))
  })

  it('encodes ProposalKind as a single-symbol vector matching the Rust unit-variant enum', () => {
    for (const tag of ['Loan', 'Treasury'] as const) {
      const [kind] = encodeArgs('get_document', {
        kind: { tag, values: undefined },
        proposal_id: 1,
      })
      expect(kind.type).toBe('scvVec')
      expect(scValToNative(kind)).toEqual([tag])
    }
  })

  it('encodes an absent Option as void and a present one as its value', () => {
    const none = encodeArgs('request_loan', { borrower: ADDR, amount: BigInt(5), metadata_cid: undefined })
    expect(none[2].type).toBe('scvVoid')
    const some = encodeArgs('request_loan', { borrower: ADDR, amount: BigInt(5), metadata_cid: 'bafy' })
    expect(scValToNative(some[2])).toBe('bafy')
  })

  it('encodes no arguments for parameterless methods', () => {
    expect(encodeArgs('get_total_members')).toEqual([])
  })

  it('encodes a LoanPolicy struct with every contract field and the right types', () => {
    const policy: LoanPolicy = {
      cooldown_period: BigInt(7 * 86_400),
      default_grace_period: BigInt(3 * 86_400),
      default_penalty_bps: 2_000,
      editing_period: BigInt(86_400),
      max_interest_rate: 2_000,
      max_loan_duration: BigInt(30 * 86_400),
      max_loan_to_treasury_ratio: 2_000,
      membership_contribution: BigInt(1_000_000),
      min_interest_rate: 500,
      min_membership_duration: BigInt(86_400),
      quorum_bps: 5_000,
      treasury_threshold: 6_000,
      voting_period: BigInt(3 * 86_400),
    }
    const [, encoded] = encodeArgs('set_loan_policy', { caller: ADDR, policy })
    const decoded = scValToNative(encoded) as Record<string, unknown>
    expect(Object.keys(decoded).sort()).toEqual(Object.keys(policy).sort())
    expect(decoded.membership_contribution).toBe(BigInt(1_000_000))
    expect(decoded.quorum_bps).toBe(5_000)
    expect(decoded.voting_period).toBe(BigInt(3 * 86_400))
  })
})
