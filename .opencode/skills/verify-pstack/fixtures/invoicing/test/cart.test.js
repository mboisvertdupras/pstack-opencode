import assert from "node:assert/strict"
import { test } from "node:test"
import { priceCart, SHIPPING } from "../src/cart/pricing.js"
import { ConflictError, ValidationError } from "../src/errors.js"
import { createService } from "../src/service.js"

const clock = { now: () => new Date("2026-03-14T10:00:00Z") }

function shop() {
  const service = createService({ clock })
  service.catalog.addProduct({ sku: "MUG-01", name: "Mug", unitPrice: 1450 })
  service.catalog.addProduct({ sku: "BOOK-01", name: "Field guide", unitPrice: 2999, taxCategory: "reduced" })
  const customer = service.customers.register({ name: "Ada", email: "ada@example.com", region: "CA" })
  return { ...service, cart: service.carts.open(customer.id) }
}

test("merges repeat adds of the same product into one line", () => {
  const { carts, cart } = shop()
  carts.addItem(cart.id, "MUG-01", 2)
  const updated = carts.addItem(cart.id, "MUG-01", 1)
  assert.deepEqual(updated.lines, [{ sku: "MUG-01", name: "Mug", unitPrice: 1450, taxCategory: "standard", quantity: 3 }])
})

test("setting a quantity to zero removes the line", () => {
  const { carts, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  carts.addItem(cart.id, "BOOK-01")
  assert.deepEqual(carts.setQuantity(cart.id, "MUG-01", 0).lines.map((line) => line.sku), ["BOOK-01"])
})

test("rejects quantities past the limit and inactive products", () => {
  const { carts, catalog, cart } = shop()
  assert.throws(() => carts.addItem(cart.id, "MUG-01", 100), ValidationError)
  carts.addItem(cart.id, "MUG-01", 98)
  assert.throws(() => carts.addItem(cart.id, "MUG-01", 2), ValidationError)
  catalog.deactivate("BOOK-01")
  assert.throws(() => carts.addItem(cart.id, "BOOK-01"), ConflictError)
})

test("keeps the price a line was added at", () => {
  const { carts, catalog, cart } = shop()
  carts.addItem(cart.id, "MUG-01")
  catalog.reprice("MUG-01", 1999)
  assert.equal(carts.get(cart.id).lines[0].unitPrice, 1450)
})

test("prices lines with per-line tax and flat shipping under the threshold", () => {
  const { carts, cart } = shop()
  carts.addItem(cart.id, "MUG-01", 2)
  carts.addItem(cart.id, "BOOK-01")
  const priced = priceCart(carts.get(cart.id), "CA")
  assert.deepEqual(priced.lines.map((line) => [line.amount, line.tax]), [[2900, 377], [2999, 150]])
  assert.equal(priced.subtotal, 5899)
  assert.equal(priced.shipping, SHIPPING.flat)
  assert.equal(priced.tax, 377 + 150 + 104)
  assert.equal(priced.total, 5899 + 799 + 631)
})

test("ships free at the threshold", () => {
  const { carts, cart } = shop()
  carts.addItem(cart.id, "BOOK-01", 3)
  assert.equal(priceCart(carts.get(cart.id), "US").shipping, 0)
})
