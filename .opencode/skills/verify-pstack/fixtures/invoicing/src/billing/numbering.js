export function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, "0")}`
}

export function nextInvoiceNumber(store, issuedAt) {
  const year = issuedAt.getUTCFullYear()
  return formatInvoiceNumber(year, store.sequence(`invoices-${year}`))
}
