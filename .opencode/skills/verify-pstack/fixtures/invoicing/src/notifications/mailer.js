import { ValidationError } from "../errors.js"

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const FROM = "billing@example-shop.test"

function checkMessage({ to, subject, text }) {
  if (!ADDRESS.test(to ?? "")) throw new ValidationError(`invalid recipient ${to}`, "to")
  if (!subject?.trim()) throw new ValidationError("subject is required", "subject")
  if (!text?.trim()) throw new ValidationError("text is required", "text")
}

export function createOutbox() {
  const sent = []
  return {
    send(message) {
      checkMessage(message)
      sent.push({ from: FROM, ...message })
    },
    sent: () => sent.map((message) => ({ ...message })),
    last: () => (sent.length ? { ...sent.at(-1) } : undefined),
  }
}

export function createConsoleMailer(log = console.log) {
  return {
    send(message) {
      checkMessage(message)
      log(`From: ${FROM}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`)
    },
  }
}
