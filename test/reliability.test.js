import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../src/clock.js'
import { FakeTransport } from '../src/transport/fake.js'
import { DiscordJsTransport } from '../src/transport/discordjs.js'
import { createDeliveryOutbox } from '../src/outbox/index.js'
import { nonceFromOperationId, computeBackoffMs, classifyTransportError } from '../src/errors.js'

function tmpOutbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discord-outbox-'))
  return { dir, storePath: join(dir, 'discord-outbox.json') }
}

describe('error classification + backoff', () => {
  it('classifies 429 / 5xx / timeout / permission / auth', () => {
    assert.equal(classifyTransportError({ code: '429', retryAfterMs: 2000 }).retry, 'retryable')
    assert.equal(classifyTransportError({ code: '429', retryAfterMs: 2000 }).retryAfterMs, 2000)
    assert.equal(classifyTransportError({ code: '5xx' }).retry, 'retryable')
    assert.equal(classifyTransportError({ code: 'timeout' }).retry, 'ambiguous')
    assert.equal(classifyTransportError({ code: 'permission' }).retry, 'terminal')
    assert.equal(classifyTransportError({ code: 'auth' }).isolateAccount, true)
  })

  it('computes bounded exponential backoff without jitter by default', () => {
    assert.equal(computeBackoffMs(1, { baseMs: 100, maxMs: 1000 }), 100)
    assert.equal(computeBackoffMs(2, { baseMs: 100, maxMs: 1000 }), 200)
    assert.equal(computeBackoffMs(5, { baseMs: 100, maxMs: 1000 }), 1000)
  })
})

describe('durable outbox', () => {
  /** @type {{ dir: string, storePath: string }} */
  let paths
  /** @type {FakeClock} */
  let clock
  /** @type {FakeTransport} */
  let transport
  /** @type {ReturnType<typeof createDeliveryOutbox>} */
  let outbox

  beforeEach(async () => {
    paths = tmpOutbox()
    clock = new FakeClock(1_000_000)
    transport = new FakeTransport()
    await transport.startAccount('alpha')
    await transport.startAccount('beta')
    outbox = createDeliveryOutbox({
      transport,
      storePath: paths.storePath,
      clock,
      retry: { baseMs: 100, maxMs: 10_000, maxAttempts: 5, jitterFn: () => 0 },
    })
    await outbox.recoverOnLoad()
  })

  afterEach(() => {
    rmSync(paths.dir, { recursive: true, force: true })
  })

  it('persists queued job and survives reopen', async () => {
    const receipt = await outbox.enqueue({
      operationId: 'op-persist-1',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'hello' },
    })
    assert.equal(receipt.state, 'queued')
    assert.ok(existsSync(paths.storePath))

    const reopened = createDeliveryOutbox({
      transport,
      storePath: paths.storePath,
      clock,
      retry: { baseMs: 100, maxMs: 10_000, maxAttempts: 5, jitterFn: () => 0 },
    })
    await reopened.recoverOnLoad()
    const again = reopened.getReceipt('op-persist-1')
    assert.equal(again.state, 'queued')
    assert.equal(again.account_id, 'alpha')
  })

  it('dedupes duplicate operation_id', async () => {
    const a = await outbox.enqueue({
      operationId: 'op-dup',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'one' },
    })
    const b = await outbox.enqueue({
      operationId: 'op-dup',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'two' },
    })
    assert.equal(a.operation_id, b.operation_id)
    assert.equal(outbox.listOperations().length, 1)
    await outbox.tick()
    assert.equal(transport.outbound.length, 1)
    assert.equal(transport.outbound[0].payload.content, 'one')
  })

  it('delivers and persists delivered receipt', async () => {
    await outbox.enqueue({
      operationId: 'op-ok',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'ok' },
      correlationId: 'corr-1',
    })
    await outbox.tick()
    const receipt = outbox.getReceipt('op-ok')
    assert.equal(receipt.state, 'delivered')
    assert.ok(receipt.discord_resource_id)
    assert.equal(receipt.correlation_id, 'corr-1')
    assert.equal(receipt.attempts, 1)
  })

  it('honors 429 Retry-After with fake clock (no early retry)', async () => {
    transport.simulateNextFailure('alpha', { code: '429', retryAfterMs: 5_000 })
    await outbox.enqueue({
      operationId: 'op-429',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'rate' },
    })
    await outbox.tick()
    let receipt = outbox.getReceipt('op-429')
    assert.equal(receipt.state, 'retry_wait')
    assert.equal(receipt.attempts, 1)
    assert.equal(receipt.error_class, 'transport_failure')

    // Too early
    clock.advance(1_000)
    await outbox.tick()
    receipt = outbox.getReceipt('op-429')
    assert.equal(receipt.state, 'retry_wait')
    assert.equal(receipt.attempts, 1)

    // After Retry-After
    clock.advance(4_000)
    await outbox.tick()
    receipt = outbox.getReceipt('op-429')
    assert.equal(receipt.state, 'delivered')
    assert.equal(receipt.attempts, 2)
    assert.equal(transport.outbound.length, 1)
  })

  it('retries 5xx with bounded max attempts', async () => {
    for (let i = 0; i < 5; i += 1) {
      transport.simulateNextFailure('alpha', '5xx')
    }
    await outbox.enqueue({
      operationId: 'op-5xx',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'x' },
    })
    for (let i = 0; i < 5; i += 1) {
      await outbox.tick()
      clock.advance(60_000)
    }
    const receipt = outbox.getReceipt('op-5xx')
    assert.equal(receipt.state, 'failed_terminal')
    assert.equal(receipt.attempts, 5)
  })

  it('permission errors are terminal without retry loop', async () => {
    transport.simulateNextFailure('alpha', 'permission')
    await outbox.enqueue({
      operationId: 'op-perm',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'nope' },
    })
    await outbox.tick()
    const receipt = outbox.getReceipt('op-perm')
    assert.equal(receipt.state, 'failed_terminal')
    assert.equal(receipt.attempts, 1)
    clock.advance(60_000)
    await outbox.tick()
    assert.equal(outbox.getReceipt('op-perm').attempts, 1)
  })

  it('auth failure isolates account without blocking others', async () => {
    transport.simulateNextFailure('alpha', 'auth')
    await outbox.enqueue({
      operationId: 'op-auth-a',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'a' },
    })
    await outbox.enqueue({
      operationId: 'op-auth-b',
      accountId: 'beta',
      operationType: 'sendMessage',
      target: { channelId: 'c2' },
      payload: { content: 'b' },
    })
    await outbox.tick()
    assert.equal(outbox.getReceipt('op-auth-a').state, 'failed_terminal')
    assert.equal(outbox.isAccountIsolated('alpha'), true)
    assert.equal(outbox.getReceipt('op-auth-b').state, 'delivered')
  })

  it('alpha 429 does not block beta deliveries', async () => {
    transport.simulateNextFailure('alpha', { code: '429', retryAfterMs: 10_000 })
    await outbox.enqueue({
      operationId: 'op-iso-a',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'a' },
    })
    await outbox.enqueue({
      operationId: 'op-iso-b',
      accountId: 'beta',
      operationType: 'sendMessage',
      target: { channelId: 'c2' },
      payload: { content: 'b' },
    })
    await outbox.tick()
    assert.equal(outbox.getReceipt('op-iso-a').state, 'retry_wait')
    assert.equal(outbox.getReceipt('op-iso-b').state, 'delivered')
  })

  it('timeout with nonce reconcile does not duplicate message', async () => {
    transport.simulateNextFailure('alpha', {
      code: 'timeout',
      applyDespiteFailure: true,
    })
    const operationId = 'op-timeout-nonce'
    await outbox.enqueue({
      operationId,
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'unique-body' },
    })
    await outbox.tick()
    assert.equal(outbox.getReceipt(operationId).state, 'retry_wait')
    assert.equal(transport.outbound.length, 1)
    const nonce = nonceFromOperationId(operationId)
    assert.equal(transport.outbound[0].payload.nonce, nonce)
    assert.equal(transport.outbound[0].payload.enforceNonce, true)

    clock.advance(1_000)
    await outbox.tick()
    const receipt = outbox.getReceipt(operationId)
    assert.equal(receipt.state, 'delivered')
    // Second attempt reused nonce → FakeTransport returned existing id; no second outbound row.
    assert.equal(transport.outbound.length, 1)
  })

  it('recovers stranded sending after crash/restart', async () => {
    await outbox.enqueue({
      operationId: 'op-crash',
      accountId: 'alpha',
      operationType: 'sendMessage',
      target: { channelId: 'c1' },
      payload: { content: 'crash-me' },
    })
    // Manually strand as sending in durable store (simulate crash mid-flight).
    const raw = JSON.parse(readFileSync(paths.storePath, 'utf8'))
    raw.operations['op-crash'].state = 'sending'
    raw.operations['op-crash'].attempt_count = 1
    writeFileSync(paths.storePath, `${JSON.stringify(raw, null, 2)}\n`)

    const recovered = createDeliveryOutbox({
      transport,
      storePath: paths.storePath,
      clock,
      retry: { baseMs: 100, maxMs: 10_000, maxAttempts: 5, jitterFn: () => 0 },
    })
    const { recovered: n } = await recovered.recoverOnLoad()
    assert.ok(n >= 1)
    assert.equal(recovered.getReceipt('op-crash').state, 'queued')
    await recovered.tick()
    assert.equal(recovered.getReceipt('op-crash').state, 'delivered')
  })

  it('multi-step group resumes after 429 without duplicating completed steps', async () => {
    await outbox.enqueueGroup({
      groupId: 'grp-1',
      accountId: 'alpha',
      steps: [
        {
          operationId: 'grp-1-s1',
          operationType: 'createThread',
          target: { parentChannelId: 'c-parent', channelId: 'c-parent' },
          payload: { threadName: 'Atlas-safe' },
        },
        {
          operationId: 'grp-1-s2',
          operationType: 'sendMessage',
          target: { channelId: 'PLACEHOLDER' },
          payload: { content: 'message-A' },
        },
        {
          operationId: 'grp-1-s3',
          operationType: 'sendMessage',
          target: { channelId: 'PLACEHOLDER' },
          payload: { content: 'message-B' },
        },
      ],
    })

    // Step 1 + 2 succeed; fail step 3 with 429 then crash/restart.
    await outbox.tick() // createThread
    assert.equal(outbox.getReceipt('grp-1-s1').state, 'delivered')
    const threadId = outbox.getReceipt('grp-1-s1').discord_resource_id
    assert.ok(threadId)

    // Point later steps at the created thread channel (consumer would do this live).
    {
      const data = JSON.parse(readFileSync(paths.storePath, 'utf8'))
      data.operations['grp-1-s2'].target.channelId = threadId
      data.operations['grp-1-s3'].target.channelId = threadId
      writeFileSync(paths.storePath, `${JSON.stringify(data, null, 2)}\n`)
    }
    outbox = createDeliveryOutbox({
      transport,
      storePath: paths.storePath,
      clock,
      retry: { baseMs: 100, maxMs: 10_000, maxAttempts: 5, jitterFn: () => 0 },
    })
    await outbox.recoverOnLoad()

    await outbox.tick() // s2
    assert.equal(outbox.getReceipt('grp-1-s2').state, 'delivered')

    transport.simulateNextFailure('alpha', { code: '429', retryAfterMs: 3_000 })
    await outbox.tick() // s3 → 429
    assert.equal(outbox.getReceipt('grp-1-s3').state, 'retry_wait')

    const outboundBeforeRestart = transport.outbound.length
    const afterCrash = createDeliveryOutbox({
      transport,
      storePath: paths.storePath,
      clock,
      retry: { baseMs: 100, maxMs: 10_000, maxAttempts: 5, jitterFn: () => 0 },
    })
    await afterCrash.recoverOnLoad()
    assert.equal(afterCrash.getReceipt('grp-1-s1').state, 'delivered')
    assert.equal(afterCrash.getReceipt('grp-1-s2').state, 'delivered')
    assert.equal(afterCrash.getReceipt('grp-1-s3').state, 'retry_wait')

    clock.advance(3_000)
    await afterCrash.tick()
    assert.equal(afterCrash.getReceipt('grp-1-s3').state, 'delivered')
    assert.equal(afterCrash.getGroup('grp-1').state, 'delivered')

    const createCount = transport.outbound.filter((o) => o.op === 'createThread').length
    const msgA = transport.outbound.filter((o) => o.payload?.content === 'message-A').length
    assert.equal(createCount, 1)
    assert.equal(msgA, 1)
    assert.ok(transport.outbound.length >= outboundBeforeRestart)
  })
})

describe('DiscordJsTransport reliability contract (no live I/O)', () => {
  it('exposes rate-limit / nonce contract without connecting', async () => {
    const t = new DiscordJsTransport({ allowConnect: false })
    const info = await t.validateDependency()
    assert.equal(info.hasClient, true)
    const contract = t.describeReliabilityContract()
    assert.equal(contract.live, false)
    assert.match(contract.rateLimit, /429/)
    assert.match(contract.nonce, /enforceNonce/)
  })
})
