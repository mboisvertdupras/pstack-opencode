import assert from "node:assert/strict"
import { test } from "node:test"
import { taxOn, taxRate } from "../src/catalog/tax.js"
import { formatMoney, percentOf, sum } from "../src/money.js"

test("formats cents with the region's currency symbol and thousands separators", () => {
  assert.equal(formatMoney(123456), "$1,234.56")
  assert.equal(formatMoney(5, "CAD"), "CA$0.05")
  assert.equal(formatMoney(-1999, "EUR"), "-€19.99")
})

test("rejects fractional cents", () => {
  assert.throws(() => formatMoney(10.5), TypeError)
})

test("rounds basis-point percentages to the nearest cent", () => {
  assert.equal(percentOf(1999, 1300), 260)
  assert.equal(percentOf(50, 1000), 5)
  assert.equal(sum([1, 2, 3]), 6)
})

test("looks tax up by region and category", () => {
  assert.equal(taxRate("CA", "reduced"), 500)
  assert.equal(taxOn(10000, "EU", "standard"), 2000)
  assert.throws(() => taxRate("MX", "standard"), RangeError)
})
