import { ConflictError, NotFoundError, ValidationError } from "../errors.js"

export const MAX_QUANTITY = 99

export function createCarts({ store, catalog, customers, clock }) {
  const get = (cartId) => {
    const cart = store.get("carts", cartId)
    if (!cart) throw new NotFoundError("cart", cartId)
    return cart
  }

  const openCart = (cartId) => {
    const cart = get(cartId)
    if (cart.status !== "open") throw new ConflictError(`cart ${cartId} is ${cart.status}`)
    return cart
  }

  const checkQuantity = (quantity) => {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
      throw new ValidationError(`quantity must be a whole number from 0 to ${MAX_QUANTITY}`, "quantity")
    }
  }

  const saveLines = (cart, lines) => store.update("carts", cart.id, { lines, updatedAt: clock.now().toISOString() })

  return {
    open(customerId) {
      customers.get(customerId)
      const now = clock.now().toISOString()
      return store.insert("carts", { id: `cart_${store.sequence("carts")}`, customerId, status: "open", lines: [], createdAt: now, updatedAt: now })
    },

    get,

    addItem(cartId, sku, quantity = 1) {
      checkQuantity(quantity)
      if (quantity === 0) throw new ValidationError("quantity must be at least 1", "quantity")
      const cart = openCart(cartId)
      const product = catalog.get(sku)
      if (!product.active) throw new ConflictError(`product ${sku} is no longer sold`)
      const existing = cart.lines.find((line) => line.sku === sku)
      const total = (existing?.quantity ?? 0) + quantity
      checkQuantity(total)
      const line = { sku, name: product.name, unitPrice: product.unitPrice, taxCategory: product.taxCategory, quantity: total }
      return saveLines(cart, existing ? cart.lines.map((each) => (each.sku === sku ? line : each)) : [...cart.lines, line])
    },

    setQuantity(cartId, sku, quantity) {
      checkQuantity(quantity)
      const cart = openCart(cartId)
      if (!cart.lines.some((line) => line.sku === sku)) throw new NotFoundError("cart line", sku)
      const lines = quantity === 0 ? cart.lines.filter((line) => line.sku !== sku) : cart.lines.map((line) => (line.sku === sku ? { ...line, quantity } : line))
      return saveLines(cart, lines)
    },

    removeItem(cartId, sku) {
      const cart = openCart(cartId)
      return saveLines(cart, cart.lines.filter((line) => line.sku !== sku))
    },

    close(cartId) {
      openCart(cartId)
      return store.update("carts", cartId, { status: "checked_out", updatedAt: clock.now().toISOString() })
    },
  }
}
