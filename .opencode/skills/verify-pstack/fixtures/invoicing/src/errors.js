export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = "ValidationError"
    this.field = field
  }
}

export class NotFoundError extends Error {
  constructor(kind, id) {
    super(`${kind} ${id} not found`)
    this.name = "NotFoundError"
    this.kind = kind
    this.id = id
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = "ConflictError"
  }
}
