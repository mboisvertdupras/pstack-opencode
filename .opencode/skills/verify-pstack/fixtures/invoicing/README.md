# invoicing

A small shop's order-to-invoice service. Customers fill carts from a catalog, check out, and get an invoice by email. Node 22 or later, no dependencies.

```sh
npm test
```

## Modules

- `src/customers` registers customers and owns their email and tax region.
- `src/catalog` holds products and the tax table, with rates in basis points per region and category.
- `src/cart` builds carts, prices them with per-line tax and flat shipping, and checks them out into orders.
- `src/billing` issues invoices from orders, numbers them per year, and records payments and voids.
- `src/notifications` renders invoice and receipt emails and sends them through an outbox or the console.
- `src/storage` is an in-memory collection store, plus a JSON-file store that persists it.

`src/service.js` wires the modules together. All amounts are integer cents.
