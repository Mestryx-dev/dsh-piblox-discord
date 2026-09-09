/**
 * Deterministic clock seam for outbox scheduling (no real sleeps in tests).
 */

export class SystemClock {
  now() {
    return Date.now()
  }
}

export class FakeClock {
  /** @param {number} [startMs] */
  constructor(startMs = 1_700_000_000_000) {
    this._now = startMs
  }

  now() {
    return this._now
  }

  /** @param {number} ms */
  advance(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new TypeError('FakeClock.advance: ms >= 0 required')
    this._now += ms
    return this._now
  }

  /** @param {number} ms */
  set(ms) {
    this._now = ms
    return this._now
  }
}
