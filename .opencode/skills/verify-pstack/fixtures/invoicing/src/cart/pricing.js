import { taxOn } from "../catalog/tax.js"
import { sum } from "../money.js"

export const SHIPPING = { flat: 799, freeOver: 7500 }

export function shippingFor(subtotal) {
  return subtotal === 0 || subtotal >= SHIPPING.freeOver ? 0 : SHIPPING.flat
}

export function priceCart(cart, region) {
  const lines = cart.lines.map((line) => {
    const amount = line.unitPrice * line.quantity
    return { ...line, amount, tax: taxOn(amount, region, line.taxCategory) }
  })
  const subtotal = sum(lines.map((line) => line.amount))
  const shipping = shippingFor(subtotal)
  const tax = sum(lines.map((line) => line.tax)) + taxOn(shipping, region, "standard")
  return { lines, subtotal, shipping, tax, total: subtotal + shipping + tax }
}
