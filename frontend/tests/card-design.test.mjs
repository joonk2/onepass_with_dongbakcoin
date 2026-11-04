import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_DESIGNS, isCardDesign, needsOnepassFirst } from '../lib/dongi/card-design.ts'

test('4 designs are offered', () => {
  assert.equal(CARD_DESIGNS.length, 4)
  assert.ok(isCardDesign('rope'))
  assert.ok(!isCardDesign('unknown'))
})

test('ONEPASS card is required before other cards', () => {
  assert.equal(needsOnepassFirst({ hasOnepassCard: false, targetIsOnepassCard: false }), true)
  assert.equal(needsOnepassFirst({ hasOnepassCard: true, targetIsOnepassCard: false }), false)
  assert.equal(needsOnepassFirst({ hasOnepassCard: false, targetIsOnepassCard: true }), false)
})
