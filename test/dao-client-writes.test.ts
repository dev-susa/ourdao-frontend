// @vitest-environment node
//
// Same Node-environment opt-in as dao-client-invoke.test.ts (Keypair.random()
// does not work with jsdom's crypto polyfill).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Account, Address, Keypair, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk'

const mockGetAccount = vi.fn()
const mockPrepareTransaction = vi.fn()
const mockSendTransaction = vi.fn()
const mockGetTransaction = vi.fn()
const mockSimulateTransaction = vi.fn()
const mockContractId = StrKey.encodeContract(Buffer.alloc(32))
let mockConfigured = true

vi.mock('@/lib/stellar', () => ({
  CONTRACT_ID: mockContractId,
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  isContractConfigured: () => mockConfigured,
  getTransactionUrl: (hash: string) => `https://example.test/tx/${hash}`,
  server: {
    getAccount: (...a: unknown[]) => mockGetAccount(...a),
    prepareTransaction: (...a: unknown[]) => mockPrepareTransaction(...a),
    sendTransaction: (...a: unknown[]) => mockSendTransaction(...a),
    getTransaction: (...a: unknown[]) => mockGetTransaction(...a),
    simulateTransaction: (...a: unknown[]) => mockSimulateTransaction(...a),
  },
}))

const { daoWrite, daoRead, read } = await import('@/lib/dao-client')

const WALLET = Keypair.random().publicKey()
const OTHER = Keypair.random().publicKey()

interface InvokeContractArgs {
  functionName: { toString(): string }
  args: xdr.ScVal[]
}

/** The `invokeContract` call carried by the (single) operation of a signed tx. */
function invokedCall(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(signedXdr, 'Test SDF Network ; September 2015')
  const op = (tx as unknown as { operations: Array<{ func: { invokeContract: InvokeContractArgs } }> })
    .operations[0]
  const call = op.func.invokeContract
  return { method: call.functionName.toString(), args: call.args }
}

describe('daoWrite — method name and ScVal argument types per entrypoint', () => {
  let signed: string[]
  const signXDR = async (x: string) => {
    signed.push(x)
    return x
  }

  beforeEach(() => {
    signed = []
    mockConfigured = true
    mockGetAccount.mockResolvedValue(new Account(WALLET, '0'))
    mockPrepareTransaction.mockImplementation(async (tx) => tx)
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc' })
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: undefined })
  })

  afterEach(() => vi.clearAllMocks())

  // commit / salt / content hash are BytesN<32> in the contract.
  const bytes = new Uint8Array(32).fill(4)
  const policy = {
    min_membership_duration: BigInt(1),
    membership_contribution: BigInt(2),
    max_loan_duration: BigInt(3),
    min_interest_rate: 4,
    max_interest_rate: 5,
    cooldown_period: BigInt(6),
    max_loan_to_treasury_ratio: 7,
    default_grace_period: BigInt(8),
    default_penalty_bps: 9,
    editing_period: BigInt(10),
    voting_period: BigInt(11),
    quorum_bps: 12,
    treasury_threshold: 13,
  }

  // [label, call, expected contract function, expected arg ScVal types]
  const cases: Array<[string, (w: ReturnType<typeof daoWrite>) => Promise<unknown>, string, string[]]> = [
    ['registerMember', (w) => w.registerMember(), 'register_member', ['scvAddress']],
    ['exitDao', (w) => w.exitDao(), 'exit_dao', ['scvAddress']],
    ['claimRewards', (w) => w.claimRewards(), 'claim_rewards', ['scvAddress']],
    ['requestLoan', (w) => w.requestLoan(BigInt(100)), 'request_loan', ['scvAddress', 'scvI128', 'scvVoid']],
    ['editLoanProposal', (w) => w.editLoanProposal(1, BigInt(50)), 'edit_loan_proposal', ['scvAddress', 'scvU32', 'scvI128']],
    ['voteOnLoanProposal', (w) => w.voteOnLoanProposal(1, true), 'vote_on_loan_proposal', ['scvAddress', 'scvU32', 'scvBool']],
    ['repayLoan', (w) => w.repayLoan(2), 'repay_loan', ['scvAddress', 'scvU32']],
    ['repayLoanPartial', (w) => w.repayLoanPartial(2, BigInt(10)), 'repay_loan_partial', ['scvAddress', 'scvU32', 'scvI128']],
    // Permissionless: no caller argument.
    ['markLoanDefaulted', (w) => w.markLoanDefaulted(3), 'mark_loan_defaulted', ['scvU32']],
    [
      'proposeTreasuryWithdrawal',
      (w) => w.proposeTreasuryWithdrawal(BigInt(5), OTHER, 'why', false),
      'propose_treasury_withdrawal',
      ['scvAddress', 'scvI128', 'scvAddress', 'scvString', 'scvBool'],
    ],
    ['voteOnTreasuryProposal', (w) => w.voteOnTreasuryProposal(4, false), 'vote_on_treasury_proposal', ['scvAddress', 'scvU32', 'scvBool']],
    ['stake', (w) => w.stake(BigInt(7)), 'stake', ['scvAddress', 'scvI128']],
    ['unstake', (w) => w.unstake(BigInt(7)), 'unstake', ['scvAddress', 'scvI128']],
    ['registerName', (w) => w.registerName('alice'), 'register_name', ['scvAddress', 'scvString']],
    ['commitTreasuryVote', (w) => w.commitTreasuryVote(1, bytes), 'commit_treasury_vote', ['scvAddress', 'scvU32', 'scvBytes']],
    [
      'revealTreasuryVote',
      (w) => w.revealTreasuryVote(1, true, bytes),
      'reveal_treasury_vote',
      ['scvAddress', 'scvU32', 'scvBool', 'scvBytes'],
    ],
    ['attachDocument', (w) => w.attachDocument('Loan', 1, bytes), 'attach_document', ['scvAddress', 'scvVec', 'scvU32', 'scvBytes']],
    ['addAdmin', (w) => w.addAdmin(OTHER), 'add_admin', ['scvAddress', 'scvAddress']],
    ['removeAdmin', (w) => w.removeAdmin(OTHER), 'remove_admin', ['scvAddress', 'scvAddress']],
    ['setConsensusThreshold', (w) => w.setConsensusThreshold(5100), 'set_consensus_threshold', ['scvAddress', 'scvU32']],
    ['setLoanPolicy', (w) => w.setLoanPolicy(policy), 'set_loan_policy', ['scvAddress', 'scvMap']],
    ['pause', (w) => w.pause(), 'pause', ['scvAddress']],
    ['unpause', (w) => w.unpause(), 'unpause', ['scvAddress']],
  ]

  it.each(cases)('%s invokes the right function with correctly typed args', async (_label, call, method, types) => {
    await call(daoWrite(WALLET, signXDR))

    expect(signed).toHaveLength(1)
    const { method: got, args } = invokedCall(signed[0])
    expect(got).toBe(method)
    expect(args.map((a) => a.type)).toEqual(types)
  })

  it('covers every entrypoint daoWrite exposes', () => {
    const exposed = Object.keys(daoWrite(WALLET, signXDR)).sort()
    expect(cases.map(([label]) => label).sort()).toEqual(exposed)
  })

  it('passes the connected wallet as the caller argument', async () => {
    await daoWrite(WALLET, signXDR).stake(BigInt(1))
    const { args } = invokedCall(signed[0])
    expect(Address.fromScVal(args[0]).toString()).toBe(WALLET)
  })

  it('propagates a signer rejection and never submits', async () => {
    const reject = async () => {
      throw new Error('User declined')
    }
    await expect(daoWrite(WALLET, reject).pause()).rejects.toThrow('User declined')
    expect(mockSendTransaction).not.toHaveBeenCalled()
  })

  it('refuses to write when no contract is configured', async () => {
    mockConfigured = false
    await expect(daoWrite(WALLET, signXDR).pause()).rejects.toThrow(/No contract configured/)
    expect(mockGetAccount).not.toHaveBeenCalled()
  })
})

describe('read()', () => {
  beforeEach(() => {
    mockConfigured = true
  })
  afterEach(() => vi.clearAllMocks())

  it('returns null without touching the network when no contract is configured', async () => {
    mockConfigured = false
    await expect(read('get_total_members')).resolves.toBeNull()
    expect(mockSimulateTransaction).not.toHaveBeenCalled()
  })

  it('throws a formatted error when the simulation fails', async () => {
    mockSimulateTransaction.mockResolvedValue({ id: '1', latestLedger: 1, events: [], error: 'HostError: boom' })
    await expect(read('get_total_members')).rejects.toThrow()
  })

  it('returns null when the simulation yields no return value', async () => {
    mockSimulateTransaction.mockResolvedValue({ id: '1', latestLedger: 1, events: [], _parsed: true })
    await expect(read('get_total_members')).resolves.toBeNull()
  })

  it('decodes a successful return value', async () => {
    mockSimulateTransaction.mockResolvedValue({
      id: '1',
      latestLedger: 1,
      events: [],
      _parsed: true,
      result: { auth: [], retval: xdr.ScVal.scvU32(42) },
    })
    await expect(daoRead.getTotalMembers()).resolves.toBe(42)
  })
})
