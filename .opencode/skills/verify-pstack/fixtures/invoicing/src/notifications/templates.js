import { formatMoney } from "../money.js"

const WIDTH = 48
const row = (label, value) => `${label}${" ".repeat(Math.max(1, WIDTH - label.length - value.length))}${value}`
const day = (iso) => iso.slice(0, 10)

function lineLabel(line) {
  return line.kind === "item" ? `${line.description} x${line.quantity}` : line.description
}

export function renderInvoiceEmail(invoice, customer) {
  const money = (amount) => formatMoney(amount, invoice.currency)
  return [
    `Hi ${customer.name},`,
    "",
    `Thanks for your order. Invoice ${invoice.number} is attached below.`,
    "",
    ...invoice.lines.map((line) => row(lineLabel(line), money(line.amount))),
    "-".repeat(WIDTH),
    row("Subtotal", money(invoice.subtotal)),
    ...(invoice.shipping > 0 ? [row("Shipping", money(invoice.shipping))] : []),
    row("Tax", money(invoice.tax)),
    row("Total due", money(invoice.total)),
    "",
    `Payment is due by ${day(invoice.dueAt)}.`,
  ].join("\n")
}

export function renderReceiptEmail(invoice, customer) {
  return [
    `Hi ${customer.name},`,
    "",
    `We received ${formatMoney(invoice.total, invoice.currency)} for invoice ${invoice.number}. It is now paid in full.`,
  ].join("\n")
}
