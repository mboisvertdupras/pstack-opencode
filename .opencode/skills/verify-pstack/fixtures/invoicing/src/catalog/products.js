import { ConflictError, NotFoundError, ValidationError } from "../errors.js"
import { assertCents } from "../money.js"
import { TAX_CATEGORIES } from "./tax.js"

const SKU = /^[A-Z0-9-]{3,20}$/

export function createCatalog({ store }) {
  const get = (sku) => {
    const product = store.get("products", sku)
    if (!product) throw new NotFoundError("product", sku)
    return product
  }

  return {
    addProduct({ sku, name, unitPrice, taxCategory = "standard" }) {
      if (!SKU.test(sku ?? "")) throw new ValidationError(`invalid sku ${sku}`, "sku")
      if (!name?.trim()) throw new ValidationError("name is required", "name")
      assertCents(unitPrice, "unitPrice")
      if (unitPrice <= 0) throw new ValidationError("unitPrice must be positive", "unitPrice")
      if (!TAX_CATEGORIES.includes(taxCategory)) throw new ValidationError(`unknown tax category ${taxCategory}`, "taxCategory")
      if (store.get("products", sku)) throw new ConflictError(`product ${sku} already exists`)
      return store.insert("products", { id: sku, sku, name: name.trim(), unitPrice, taxCategory, active: true })
    },

    get,

    list({ includeInactive = false } = {}) {
      return store.find("products", (product) => includeInactive || product.active).sort((a, b) => a.sku.localeCompare(b.sku))
    },

    reprice(sku, unitPrice) {
      get(sku)
      assertCents(unitPrice, "unitPrice")
      if (unitPrice <= 0) throw new ValidationError("unitPrice must be positive", "unitPrice")
      return store.update("products", sku, { unitPrice })
    },

    deactivate(sku) {
      get(sku)
      return store.update("products", sku, { active: false })
    },
  }
}
