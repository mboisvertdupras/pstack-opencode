const SYMBOLS = { USD: "$", CAD: "CA$", EUR: "€" }

export function assertCents(value, field = "amount") {
  if (!Number.isInteger(value)) throw new TypeError(`${field} must be integer cents, got ${value}`)
  return value
}

export const sum = (amounts) => amounts.reduce((total, amount) => total + amount, 0)

// Rates are basis points (1300 = 13%) so tax math never touches floats until the final round.
export const percentOf = (amount, basisPoints) => Math.round((amount * basisPoints) / 10_000)

export function formatMoney(amount, currency = "USD") {
  assertCents(amount)
  const sign = amount < 0 ? "-" : ""
  const abs = Math.abs(amount)
  const dollars = Math.floor(abs / 100).toLocaleString("en-US")
  const symbol = SYMBOLS[currency] ?? `${currency} `
  return `${sign}${symbol}${dollars}.${String(abs % 100).padStart(2, "0")}`
}
