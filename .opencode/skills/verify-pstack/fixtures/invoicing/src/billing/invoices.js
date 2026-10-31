import { ConflictError, NotFoundError, ValidationError } from "../errors.js"
import { assertCents, sum } from "../money.js"
import { nextInvoiceNumber } from "./numbering.js"

export const PAYMENT_TERMS_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export const balance = (invoice) => invoice.total - sum(invoice.payments.map((payment) => payment.amount))

function invoiceLines(order) {
  const lines = order.lines.map((line) => ({
    kind: "item",
    sku: line.sku,
    description: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
  }))
  if (order.shipping > 0) lines.push({ kind: "shipping", description: "Shipping", quantity: 1, unitPrice: order.shipping, amount: order.shipping })
  return lines
}

export function createInvoices({ store, clock, notifier }) {
  const get = (id) => {
    const invoice = store.get("invoices", id)
    if (!invoice) throw new NotFoundError("invoice", id)
    return invoice
  }

  return {
    issue(order) {
      const issuedAt = clock.now()
      const number = nextInvoiceNumber(store, issuedAt)
      const invoice = store.insert("invoices", {
        id: number,
        number,
        orderId: order.id,
        customerId: order.customerId,
        currency: order.currency,
        lines: invoiceLines(order),
        subtotal: order.subtotal,
        shipping: order.shipping,
        tax: order.tax,
        total: order.total,
        payments: [],
        status: "open",
        issuedAt: issuedAt.toISOString(),
        dueAt: new Date(issuedAt.getTime() + PAYMENT_TERMS_DAYS * DAY).toISOString(),
      })
      notifier.invoiceIssued(invoice)
      return invoice
    },

    get,

    listForCustomer(customerId) {
      return store.find("invoices", (invoice) => invoice.customerId === customerId).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
    },

    recordPayment(id, amount) {
      assertCents(amount)
      const invoice = get(id)
      if (invoice.status !== "open") throw new ConflictError(`invoice ${id} is ${invoice.status}`)
      if (amount <= 0 || amount > balance(invoice)) throw new ValidationError(`payment must be between 1 and ${balance(invoice)} cents`, "amount")
      const payments = [...invoice.payments, { amount, paidAt: clock.now().toISOString() }]
      const paid = sum(payments.map((payment) => payment.amount)) === invoice.total
      const updated = store.update("invoices", id, { payments, status: paid ? "paid" : "open" })
      if (paid) notifier.invoicePaid(updated)
      return updated
    },

    void(id, reason) {
      const invoice = get(id)
      if (invoice.status !== "open") throw new ConflictError(`invoice ${id} is ${invoice.status}`)
      if (invoice.payments.length > 0) throw new ConflictError(`invoice ${id} has payments and cannot be voided`)
      if (!reason?.trim()) throw new ValidationError("a void needs a reason", "reason")
      return store.update("invoices", id, { status: "void", voidReason: reason.trim() })
    },

    overdue() {
      const now = clock.now().toISOString()
      return store.find("invoices", (invoice) => invoice.status === "open" && invoice.dueAt < now)
    },
  }
}
