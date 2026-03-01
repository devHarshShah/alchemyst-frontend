const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

interface ApiErrorResponse {
  statusCode?: number
  message?: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getApiErrorMessage = (value: unknown, fallback: string): string => {
  if (!isObject(value)) {
    return fallback
  }

  const apiError = value as ApiErrorResponse
  if (typeof apiError.message === "string" && apiError.message.trim().length > 0) {
    return apiError.message
  }

  return fallback
}

export interface ChatSessionStartData {
  sessionId: string
  firstMessage: string | null
  timestamp: string | null
}

export interface ChatSessionStartResponse {
  statusCode: number
  message: string
  data: ChatSessionStartData
}

export type ChatMessageRole = "user" | "assistant" | "system"

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: string
  timestamp: string
  interrupted: boolean
}

export interface ChatSessionLastMessage {
  role: ChatMessageRole
  content: string
  timestamp: string
  interrupted: boolean
}

export interface ChatSessionSummary {
  sessionId: string
  sessionEnded: boolean
  messageCount: number
  updatedAt: string
  lastMessage: ChatSessionLastMessage | null
}

const pickString = (value: unknown, keys: string[]): string | null => {
  if (!isObject(value)) {
    return null
  }

  for (const key of keys) {
    const entry = value[key]
    if (typeof entry === "string" && entry.trim().length > 0) {
      return entry
    }
  }

  return null
}

const parseSessionStartResponse = (value: unknown): ChatSessionStartResponse => {
  if (!isObject(value)) {
    throw new Error("Unexpected response from chat API")
  }

  const statusCode = value.statusCode
  const message = value.message
  const data = value.data

  if (typeof statusCode !== "number" || typeof message !== "string") {
    throw new Error("Unexpected response from chat API")
  }

  const sessionId = pickString(data, ["sessionId", "id"])
  if (!sessionId) {
    throw new Error("Missing session id in chat session response")
  }

  const assistantMessage = pickString(data, [
    "firstMessage",
    "assistantMessage",
    "greeting",
    "message",
    "text",
  ])
  const timestamp = pickString(data, ["timestamp", "createdAt", "updatedAt"])

  return {
    statusCode,
    message,
    data: {
      sessionId,
      firstMessage: assistantMessage,
      timestamp,
    },
  }
}

const parseRole = (value: unknown): ChatMessageRole => {
  if (value === "user" || value === "assistant" || value === "system") {
    return value
  }
  return "assistant"
}

const parseLastMessage = (value: unknown): ChatSessionLastMessage | null => {
  if (!isObject(value)) {
    return null
  }

  const content = pickString(value, ["content", "text", "message"])
  const timestamp =
    pickString(value, ["timestamp", "createdAt", "updatedAt"]) ??
    new Date().toISOString()

  if (!content) {
    return null
  }

  return {
    role: parseRole(value.role),
    content,
    timestamp,
    interrupted: value.interrupted === true,
  }
}

const parseSessionSummary = (value: unknown): ChatSessionSummary | null => {
  if (!isObject(value)) {
    return null
  }

  const sessionId = pickString(value, ["sessionId"])
  const updatedAt =
    pickString(value, ["updatedAt", "timestamp", "createdAt"]) ??
    new Date().toISOString()
  const messageCount =
    typeof value.messageCount === "number" ? value.messageCount : 0

  if (!sessionId) {
    return null
  }

  return {
    sessionId,
    sessionEnded: value.sessionEnded === true,
    messageCount,
    updatedAt,
    lastMessage: parseLastMessage(value.lastMessage),
  }
}

const parseSessionsResponse = (value: unknown): ChatSessionSummary[] => {
  if (!isObject(value) || !isObject(value.data) || !Array.isArray(value.data.sessions)) {
    return []
  }

  return value.data.sessions
    .map((item) => parseSessionSummary(item))
    .filter((item): item is ChatSessionSummary => item !== null)
}

const parseChatMessage = (value: unknown): ChatMessage | null => {
  if (!isObject(value)) {
    return null
  }

  const id = pickString(value, ["id", "messageId"])
  const text = pickString(value, ["text", "message", "content"])
  const timestamp =
    pickString(value, ["timestamp", "createdAt", "updatedAt"]) ??
    new Date().toISOString()

  if (!id || !text) {
    return null
  }

  return {
    id,
    role: parseRole(value.role),
    text,
    timestamp,
    interrupted: value.interrupted === true,
  }
}

const parseHistoryResponse = (value: unknown): ChatMessage[] => {
  if (!isObject(value)) {
    return []
  }

  const data = value.data
  const messageList = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.messages)
      ? data.messages
      : null

  if (!messageList) {
    return []
  }

  return messageList
    .map((item) => parseChatMessage(item))
    .filter((item): item is ChatMessage => item !== null)
}

const buildAuthHeaders = (token?: string): HeadersInit => {
  const headers: HeadersInit = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export const startChatSession = async (
  token?: string,
  sessionId?: string
): Promise<ChatSessionStartResponse> => {
  const response = await fetch(`${API_BASE_URL}/chat/session/start`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(token),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(
      typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : {}
    ),
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `Request failed with status ${response.status}`)
    )
  }

  return parseSessionStartResponse(payload)
}

export const getChatHistory = async (
  sessionId: string,
  token?: string
): Promise<ChatMessage[]> => {
  const response = await fetch(
    `${API_BASE_URL}/chat/history/${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: buildAuthHeaders(token),
      credentials: "include",
    }
  )

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `Request failed with status ${response.status}`)
    )
  }

  return parseHistoryResponse(payload)
}

export const getChatSessions = async (token?: string): Promise<ChatSessionSummary[]> => {
  const response = await fetch(`${API_BASE_URL}/chat/sessions`, {
    method: "GET",
    headers: buildAuthHeaders(token),
    credentials: "include",
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `Request failed with status ${response.status}`)
    )
  }

  return parseSessionsResponse(payload)
}
