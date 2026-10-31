import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePhrases, serializePhrases } from '../src/phrases.js'

test('parsePhrases groups in order and dedups globally', () => {
  const raw = '666\n主播好棒\n#互动\n666\n关注一下\n\n#  售后 \n发货了吗'
  const groups = parsePhrases(raw)
  assert.deepEqual(groups.map((g) => g.name), ['默认', '互动', '售后'])
  assert.deepEqual(groups[0].items, ['666', '主播好棒'])
  assert.deepEqual(groups[1].items, ['关注一下'])
  assert.deepEqual(groups[2].items, ['发货了吗'])
})

test('serializePhrases round-trips through parsePhrases', () => {
  const raw = '#开场\n666\n#互动\n关注一下'
  const text = serializePhrases(parsePhrases(raw))
  assert.equal(text, '#开场\n666\n#互动\n关注一下')
  assert.deepEqual(parsePhrases(text), parsePhrases(raw))
})

test('single unnamed group serializes without a header', () => {
  assert.equal(serializePhrases(parsePhrases('666\n666\n支持一下')), '666\n支持一下')
  assert.deepEqual(parsePhrases('  \n\n'), [])
})
