import { percentOf } from "../money.js"

const RATES = {
  CA: { standard: 1300, reduced: 500, exempt: 0 },
  US: { standard: 800, reduced: 400, exempt: 0 },
  EU: { standard: 2000, reduced: 1000, exempt: 0 },
}

export const REGIONS = Object.keys(RATES)
export const TAX_CATEGORIES = Object.keys(RATES.CA)
export const CURRENCY = { CA: "CAD", US: "USD", EU: "EUR" }

export function taxRate(region, category) {
  const rate = RATES[region]?.[category]
  if (rate === undefined) throw new RangeError(`no tax rate for ${category} in ${region}`)
  return rate
}

export const taxOn = (amount, region, category) => percentOf(amount, taxRate(region, category))
