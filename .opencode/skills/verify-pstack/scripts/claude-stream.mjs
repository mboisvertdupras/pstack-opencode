const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
const AGENT_TOOLS = new Set(["Agent", "Task"])
const TODO_FILE = /(?:^|\/)(?:[\w.-]+\.)?todo\.md$/
const unprefix = (id) => id?.replace(/^pstack:/, "")
const checklist = (text = "") => [...text.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\[.\]\s+)?(.+)$/gm)].map(([, content]) => ({ content }))

function toolPart(block, time) {
  const input = block.input ?? {}
  const tool = (name, state) => ({ type: "tool", name, state: { status: "completed", input: state }, time: { created: time } })
  if (block.name === "Skill") return tool("skill", { id: unprefix(input.skill) })
  if (AGENT_TOOLS.has(block.name)) return tool("subagent", { agent: unprefix(input.subagent_type ?? "general-purpose"), description: input.description, prompt: input.prompt })
  if (block.name === "Read") return tool("read", { path: input.file_path })
  if (block.name === "Bash") return tool("shell", { command: input.command })
  if (block.name === "TodoWrite") return tool("todowrite", { todos: (input.todos ?? []).map(({ content }) => ({ content })) })
  if (block.name === "TaskCreate") return tool("todowrite", { todos: [{ content: [input.subject, input.description].filter(Boolean).join(" ") }] })
  if (block.name === "Write" && TODO_FILE.test(input.file_path ?? "")) return tool("todowrite", { todos: checklist(input.content) })
  if (EDIT_TOOLS.has(block.name)) return tool("edit", { path: input.file_path ?? input.notebook_path })
  return tool(block.name, input)
}

export function sessionTree(stream, { prompt, skills = [], catalog }) {
  const init = stream.find((event) => event.type === "system" && event.subtype === "init")
  const rootID = init?.session_id ?? "root"
  const sessions = new Map()
  const openTodos = new Map()
  const open = (id, agent) => {
    if (!sessions.has(id)) sessions.set(id, { info: { id, agent }, messages: [] })
    return sessions.get(id)
  }
  const root = open(rootID, "claude")
  root.messages.push({ type: "user", text: prompt, skills: skills.map((id) => ({ id })) })

  stream.forEach((event, time) => {
    if (event.type === "result" && event.is_error) root.messages.push({ type: "assistant", error: { type: event.subtype, message: event.result ?? event.subtype }, content: [] })
    if (event.type !== "assistant") return
    const owner = event.parent_tool_use_id ?? rootID
    const session = open(owner, "unknown")
    const content = []
    for (const block of event.message?.content ?? []) {
      if (block.type === "text") content.push({ type: "text", text: block.text })
      if (block.type !== "tool_use") continue
      const part = toolPart(block, time)
      if (part.name === "subagent") open(block.id, part.state.input.agent)
      if (block.name === "TaskCreate" && openTodos.has(owner)) {
        openTodos.get(owner).state.input.todos.push(...part.state.input.todos)
        continue
      }
      if (block.name === "TaskCreate") openTodos.set(owner, part)
      else if (block.name !== "ToolSearch") openTodos.delete(owner)
      content.push(part)
    }
    session.messages.push({ type: "assistant", content, ...(event.error ? { error: { type: event.error, message: event.error } } : {}) })
  })

  return { parent: root, children: [...sessions.values()].filter((session) => session !== root), catalog }
}
