import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CELLS, cellsFor, gridShape, hiddenFor } from '../src/gridLayout.js'

test('gridShape keeps a single cell for an empty wall', () => {
  assert.deepEqual(gridShape(0), { cols: 1, cells: 0, hidden: 0 })
  assert.deepEqual(gridShape(1), { cols: 1, cells: 1, hidden: 0 })
})

test('gridShape uses two columns up to four cells', () => {
  for (const n of [2, 3, 4]) {
    const shape = gridShape(n)
    assert.equal(shape.cols, 2, `${n} 格应为两列`)
    assert.equal(shape.cells, n)
    assert.equal(shape.hidden, 0)
  }
})

test('gridShape switches to three columns from five to nine', () => {
  for (const n of [5, 6, 9]) {
    assert.equal(gridShape(n).cols, 3, `${n} 格应为三列`)
  }
})

test('gridShape uses four columns beyond nine', () => {
  // 十格开始用四列，否则行数堆太多、每格扁得像条。
  for (const n of [10, 11, 12]) {
    assert.equal(gridShape(n).cols, 4, `${n} 格应为四列`)
  }
})

test('gridShape caps the wall at MAX_CELLS and reports the overflow', () => {
  const shape = gridShape(20)
  assert.equal(shape.cells, MAX_CELLS)
  assert.equal(shape.hidden, 20 - MAX_CELLS)
})

test('MAX_CELLS fits ten accounts on the wall', () => {
  // 这是提上限的直接原因：原先 9 格时第十个账号上不了墙。
  assert.ok(MAX_CELLS >= 10, `上限 ${MAX_CELLS} 装不下十个账号`)
  assert.equal(gridShape(10).hidden, 0)
  assert.equal(gridShape(10).cells, 10)
})

test('gridShape tolerates junk input', () => {
  for (const value of [null, undefined, NaN, -3, 'x']) {
    const shape = gridShape(value)
    assert.equal(shape.cells, 0)
    assert.equal(shape.cols, 1)
  }
})

test('cellsFor takes the first MAX_CELLS accounts in order', () => {
  const accounts = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}` }))
  const shown = cellsFor(accounts)
  assert.equal(shown.length, MAX_CELLS)
  assert.equal(shown[0].id, 'a0')
  assert.equal(shown[MAX_CELLS - 1].id, `a${MAX_CELLS - 1}`)
})

test('cellsFor puts main accounts first', () => {
  // 十格先给要盯的，主力优先上墙。
  const accounts = [
    { id: 's1', tier: 'spare' },
    { id: 'm1', tier: 'main' },
    { id: 's2', tier: 'spare' },
    { id: 'm2', tier: 'main' }
  ]
  const shown = cellsFor(accounts)
  assert.deepEqual(shown.map((a) => a.id), ['m1', 'm2', 's1', 's2'])
})

test('cellsFor keeps original order within the same tier', () => {
  const accounts = [
    { id: 'x', tier: 'main' },
    { id: 'a', tier: 'spare' },
    { id: 'y', tier: 'main' },
    { id: 'b', tier: 'spare' }
  ]
  assert.deepEqual(cellsFor(accounts).map((a) => a.id), ['x', 'y', 'a', 'b'])
})

test('cellsFor sorts missing or unknown tiers as spare', () => {
  const accounts = [{ id: 'none' }, { id: 'weird', tier: 'boss' }, { id: 'm', tier: 'main' }]
  assert.deepEqual(cellsFor(accounts).map((a) => a.id), ['m', 'none', 'weird'])
})

test('cellsFor respects a custom limit', () => {
  const accounts = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}` }))
  assert.equal(cellsFor(accounts, 3).length, 3)
  assert.deepEqual(cellsFor(accounts, 0), [])
})

test('cellsFor handles a missing list', () => {
  assert.deepEqual(cellsFor(null), [])
  assert.deepEqual(cellsFor(undefined), [])
})

test('hiddenFor returns the accounts that did not fit', () => {
  const accounts = Array.from({ length: 15 }, (_, i) => ({ id: `a${i}` }))
  const hidden = hiddenFor(accounts)
  assert.equal(hidden.length, 15 - MAX_CELLS)
  assert.equal(hidden[0].id, `a${MAX_CELLS}`)
})

test('hiddenFor accounts for tier reordering', () => {
  // 主力被提到前面后，被挤下去的应该是排在后面的备用号。
  const accounts = Array.from({ length: MAX_CELLS }, (_, i) => ({ id: `s${i}`, tier: 'spare' }))
  accounts.push({ id: 'm', tier: 'main' })
  const hidden = hiddenFor(accounts)
  assert.equal(hidden.length, 1)
  assert.equal(hidden[0].id, `s${MAX_CELLS - 1}`)
})

test('hiddenFor is empty when everything fits', () => {
  const accounts = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(hiddenFor(accounts), [])
})
