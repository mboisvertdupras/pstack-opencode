import { renderInvoiceEmail, renderReceiptEmail } from "./templates.js"

export function createInvoiceNotifier({ customers, mailer }) {
  return {
    invoiceIssued(invoice) {
      const customer = customers.get(invoice.customerId)
      mailer.send({ to: customer.email, subject: `Invoice ${invoice.number}`, text: renderInvoiceEmail(invoice, customer) })
    },

    invoicePaid(invoice) {
      const customer = customers.get(invoice.customerId)
      mailer.send({ to: customer.email, subject: `Receipt for ${invoice.number}`, text: renderReceiptEmail(invoice, customer) })
    },
  }
}
