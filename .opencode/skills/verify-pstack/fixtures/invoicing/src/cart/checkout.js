import { CURRENCY } from "../catalog/tax.js"
import { ValidationError } from "../errors.js"
import { priceCart } from "./pricing.js"

export function createCheckout({ store, carts, catalog, customers, invoices, clock }) {
  return {
    checkout(cartId) {
      const cart = carts.get(cartId)
      if (cart.lines.length === 0) throw new ValidationError("cart is empty", "lines")
      for (const line of cart.lines) {
        if (!catalog.get(line.sku).active) throw new ValidationError(`product ${line.sku} is no longer sold`, "lines")
      }
      const customer = customers.get(cart.customerId)
      const priced = priceCart(cart, customer.region)
      carts.close(cartId)
      const order = store.insert("orders", {
        id: `ord_${store.sequence("orders")}`,
        cartId,
        customerId: customer.id,
        region: customer.region,
        currency: CURRENCY[customer.region],
        ...priced,
        placedAt: clock.now().toISOString(),
      })
      const invoice = invoices.issue(order)
      return { order, invoice }
    },
  }
}
