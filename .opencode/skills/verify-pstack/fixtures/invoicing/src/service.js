import { createInvoices } from "./billing/invoices.js"
import { createCheckout } from "./cart/checkout.js"
import { createCarts } from "./cart/cart.js"
import { createCatalog } from "./catalog/products.js"
import { createCustomers } from "./customers/customers.js"
import { createOutbox } from "./notifications/mailer.js"
import { createInvoiceNotifier } from "./notifications/invoice-email.js"
import { createMemoryStore } from "./storage/memory-store.js"

export const systemClock = { now: () => new Date() }

export function createService({ store = createMemoryStore(), clock = systemClock, mailer = createOutbox() } = {}) {
  const customers = createCustomers({ store, clock })
  const catalog = createCatalog({ store })
  const notifier = createInvoiceNotifier({ customers, mailer })
  const invoices = createInvoices({ store, clock, notifier })
  const carts = createCarts({ store, catalog, customers, clock })
  const checkout = createCheckout({ store, carts, catalog, customers, invoices, clock })
  return { store, mailer, customers, catalog, carts, checkout, invoices }
}
