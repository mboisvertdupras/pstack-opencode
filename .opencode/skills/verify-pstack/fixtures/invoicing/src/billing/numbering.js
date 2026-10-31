export function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, "0")}`
}

// Numbers restart each calendar year, so the sequence is keyed by year.
export function nextInvoiceNumber(store, issuedAt) {
  const year = issuedAt.getUTCFullYear()
  return formatInvoiceNumber(year, store.sequence(`invoices-${year}`))
}
