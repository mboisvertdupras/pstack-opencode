import { ConflictError, NotFoundError, ValidationError } from "../errors.js"
import { REGIONS } from "../catalog/tax.js"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createCustomers({ store, clock }) {
  const findByEmail = (email) => store.find("customers", (customer) => customer.email === email.trim().toLowerCase())[0]

  return {
    register({ name, email, region }) {
      if (!name?.trim()) throw new ValidationError("name is required", "name")
      if (!EMAIL.test(email ?? "")) throw new ValidationError(`invalid email ${email}`, "email")
      if (!REGIONS.includes(region)) throw new ValidationError(`unknown region ${region}`, "region")
      if (findByEmail(email)) throw new ConflictError(`a customer with ${email} already exists`)
      return store.insert("customers", {
        id: `cus_${store.sequence("customers")}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        region,
        createdAt: clock.now().toISOString(),
      })
    },

    get(id) {
      const customer = store.get("customers", id)
      if (!customer) throw new NotFoundError("customer", id)
      return customer
    },

    findByEmail,

    updateEmail(id, email) {
      if (!EMAIL.test(email ?? "")) throw new ValidationError(`invalid email ${email}`, "email")
      const owner = findByEmail(email)
      if (owner && owner.id !== id) throw new ConflictError(`a customer with ${email} already exists`)
      return store.update("customers", id, { email: email.trim().toLowerCase() })
    },
  }
}
