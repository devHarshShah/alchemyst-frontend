"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AppSidebar, type SidebarHistoryItem } from "@/components/app-sidebar"
import { ChatCenter } from "@/components/chat-center"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import {
  getChatHistory,
  startChatSession,
  type ChatMessage,
  type ChatMessageRole,
} from "@/lib/chat"

interface PersistedChatHistory {
  id: string
  title: string
  updatedAt: string
}

type SocketState = "open" | "closed" | "error"

interface JoinEventPayload {
  type: "join"
  sessionId: string
}

interface UserMessageEventPayload {
  type: "user_message"
  text: string
}

interface PingEventPayload {
  type: "ping"
}

interface WsIncomingMessage {
  type: string
  sessionId?: string
  text?: string
  chunk?: string
  partialText?: string
  timestamp?: string
  role?: string
  interrupted?: boolean
  reason?: string
  statusCode?: number
  messages?: unknown[]
}

const isPersistedHistory = (value: unknown): value is PersistedChatHistory =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  "title" in value &&
  "updatedAt" in value &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.updatedAt === "string"

const loadHistory = (): SidebarHistoryItem[] => {
  const raw = localStorage.getItem("chat_history")
  if (!raw) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
    .filter(isPersistedHistory)
    .map((item) => ({
      id: item.id,
      title: item.title,
      url: `/dashboard?sessionId=${encodeURIComponent(item.id)}`,
      updatedAt: item.updatedAt,
    }))
}

const persistHistory = (historyItems: SidebarHistoryItem[]): void => {
  const serializable: PersistedChatHistory[] = historyItems.map((item) => ({
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
  }))
  localStorage.setItem("chat_history", JSON.stringify(serializable))
}

const getNowTimestamp = (): string => new Date().toISOString()

const formatHistoryTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const toHistoryItem = (
  sessionId: string,
  title: string,
  timestamp: string
): SidebarHistoryItem => ({
  id: sessionId,
  title,
  url: `/dashboard?sessionId=${encodeURIComponent(sessionId)}`,
  updatedAt: formatHistoryTimestamp(timestamp),
})

const getWebSocketUrl = (token?: string): string => {
  const configuredBase =
    process.env.NEXT_PUBLIC_WS_URL ??
    (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(
      /^http/,
      "ws"
    )

  const url = new URL(configuredBase)
  if (url.pathname === "/") {
    url.pathname = "/chat/ws"
  }

  if (token) {
    url.searchParams.set("token", token)
  }

  return url.toString()
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const parseRole = (value: unknown): ChatMessageRole =>
  value === "user" || value === "assistant" || value === "system"
    ? value
    : "assistant"

const pickString = (value: unknown, keys: string[]): string | null => {
  if (!isObject(value)) {
    return null
  }

  for (const key of keys) {
    const entry = value[key]
    if (typeof entry === "string" && entry.length > 0) {
      return entry
    }
  }

  return null
}

const parseHistoryMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item): ChatMessage | null => {
      if (!isObject(item)) {
        return null
      }

      const id = pickString(item, ["id", "messageId"])
      const text = pickString(item, ["content", "text", "message"])
      const timestamp =
        pickString(item, ["timestamp", "createdAt", "updatedAt"]) ??
        getNowTimestamp()

      if (!id || !text) {
        return null
      }

      return {
        id,
        role: parseRole(item.role),
        text,
        timestamp,
        interrupted: item.interrupted === true,
      }
    })
    .filter((item): item is ChatMessage => item !== null)
}

const parseWsMessage = (value: unknown): WsIncomingMessage | null => {
  if (!isObject(value) || typeof value.type !== "string") {
    return null
  }

  return {
    type: value.type,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    text: typeof value.text === "string" ? value.text : undefined,
    chunk: typeof value.chunk === "string" ? value.chunk : undefined,
    partialText:
      typeof value.partialText === "string" ? value.partialText : undefined,
    timestamp:
      typeof value.timestamp === "string" ? value.timestamp : getNowTimestamp(),
    role: typeof value.role === "string" ? value.role : undefined,
    interrupted: value.interrupted === true,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    statusCode: typeof value.statusCode === "number" ? value.statusCode : undefined,
    messages: Array.isArray(value.messages) ? value.messages : undefined,
  }
}

const createMessage = (
  role: ChatMessageRole,
  text: string,
  timestamp: string,
  interrupted = false
): ChatMessage => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
  role,
  text,
  timestamp,
  interrupted,
})

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeSessionId = searchParams.get("sessionId")

  const [user, setUser] = useState<AuthUser | null>(null)
  const [socketState, setSocketState] = useState<SocketState>("closed")
  const [history, setHistory] = useState<SidebarHistoryItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isStartingChat, setIsStartingChat] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)
  const pendingJoinSessionIdRef = useRef<string | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)

  const upsertHistoryItem = useCallback(
    (sessionId: string, title: string, timestamp: string): void => {
      setHistory((previous) => {
        const next = [
          toHistoryItem(sessionId, title, timestamp),
          ...previous.filter((item) => item.id !== sessionId),
        ]
        persistHistory(next)
        return next
      })
    },
    []
  )

  const sendJoinEvent = useCallback((sessionId: string): void => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingJoinSessionIdRef.current = sessionId
      return
    }

    const payload: JoinEventPayload = { type: "join", sessionId }
    socket.send(JSON.stringify(payload))
    pendingJoinSessionIdRef.current = null
  }, [])

  const bootstrapSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const token = localStorage.getItem("auth_token") ?? undefined
      if (!token) {
        return
      }

      const start = await startChatSession(token, sessionId)
      const resolvedSessionId = start.data.sessionId
      const greeting = start.data.firstMessage?.trim() ?? ""
      const timestamp = start.data.timestamp ?? getNowTimestamp()

      if (resolvedSessionId !== sessionId) {
        router.replace(`/dashboard?sessionId=${encodeURIComponent(resolvedSessionId)}`)
      }

      if (greeting.length > 0) {
        upsertHistoryItem(resolvedSessionId, greeting.slice(0, 40), timestamp)
      }

      sendJoinEvent(resolvedSessionId)
      const historyItems = await getChatHistory(resolvedSessionId, token)
      setMessages(historyItems)
    },
    [router, sendJoinEvent, upsertHistoryItem]
  )

  const onNewChat = useCallback(async () => {
    const token = localStorage.getItem("auth_token") ?? undefined
    if (!token) {
      toast.error("Please login again to start a new chat")
      return
    }

    setIsStartingChat(true)
    setIsLoadingHistory(true)
    const loadingToast = toast.loading("Starting a new chat...")

    try {
      const response = await startChatSession(token)
      const sessionId = response.data.sessionId
      const firstMessage = response.data.firstMessage?.trim() ?? ""
      const timestamp = response.data.timestamp ?? getNowTimestamp()

      upsertHistoryItem(sessionId, firstMessage.slice(0, 40) || "New chat", timestamp)
      sendJoinEvent(sessionId)
      router.push(`/dashboard?sessionId=${encodeURIComponent(sessionId)}`)

      if (firstMessage.length > 0) {
        setMessages([createMessage("assistant", firstMessage, timestamp)])
      } else {
        setMessages([])
      }

      toast.dismiss(loadingToast)
      toast.success("New chat session created")
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to start chat session"
      toast.dismiss(loadingToast)
      toast.error(message)
    } finally {
      setIsStartingChat(false)
      setIsLoadingHistory(false)
    }
  }, [router, sendJoinEvent, upsertHistoryItem])

  const onSendMessage = useCallback(() => {
    if (!activeSessionId) {
      toast.error("Create or select a chat first")
      return
    }

    const text = inputValue.trim()
    if (text.length === 0) {
      return
    }

    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.error("Realtime connection is not ready")
      return
    }

    const payload: UserMessageEventPayload = { type: "user_message", text }
    socket.send(JSON.stringify(payload))

    const timestamp = getNowTimestamp()
    setMessages((previous) => [...previous, createMessage("user", text, timestamp)])
    setInputValue("")
    setIsSendingMessage(true)
    upsertHistoryItem(activeSessionId, text.slice(0, 40), timestamp)
  }, [activeSessionId, inputValue, upsertHistoryItem])

  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? undefined
    getCurrentUser(token)
      .then((currentUser) => {
        setUser(currentUser)
        localStorage.setItem("auth_user", JSON.stringify(currentUser))
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unable to load user profile"
        toast.error(message)
      })
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setHistory(loadHistory())
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? undefined
    if (!token) {
      return
    }

    let isCurrentConnection = true
    const socket = new WebSocket(getWebSocketUrl(token))
    socketRef.current = socket

    socket.onopen = () => {
      if (!isCurrentConnection) {
        return
      }

      setSocketState("open")
      const initialSessionId = pendingJoinSessionIdRef.current ?? activeSessionId
      if (initialSessionId) {
        sendJoinEvent(initialSessionId)
      }
    }

    socket.onclose = () => {
      if (!isCurrentConnection) {
        return
      }
      setSocketState("closed")
      setIsSendingMessage(false)
      setIsStreaming(false)
    }

    socket.onerror = () => {
      if (!isCurrentConnection) {
        return
      }
      setSocketState("error")
    }

    socket.onmessage = (event: MessageEvent<string>) => {
      if (!isCurrentConnection) {
        return
      }

      let payload: unknown
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      const message = parseWsMessage(payload)
      if (!message) {
        return
      }

      if (message.type === "history") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        setMessages(parseHistoryMessages(message.messages))
        setIsLoadingHistory(false)
        setIsSendingMessage(false)
        setIsStreaming(false)
        streamingMessageIdRef.current = null
        return
      }

      if (message.type === "assistant_stream_start") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        setIsStreaming(true)
        const draftMessage = createMessage(
          "assistant",
          "",
          message.timestamp ?? getNowTimestamp()
        )
        streamingMessageIdRef.current = draftMessage.id
        setMessages((previous) => [...previous, draftMessage])
        return
      }

      if (message.type === "assistant_stream_chunk") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        const chunk = message.chunk ?? ""
        const draftId = streamingMessageIdRef.current
        if (!draftId || chunk.length === 0) {
          return
        }
        setMessages((previous) =>
          previous.map((item) =>
            item.id === draftId ? { ...item, text: `${item.text}${chunk}` } : item
          )
        )
        return
      }

      if (message.type === "assistant_stream_end") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        setIsStreaming(false)
        if (typeof message.text === "string" && message.text.length > 0) {
          const draftId = streamingMessageIdRef.current
          if (draftId) {
            setMessages((previous) =>
              previous.map((item) =>
                item.id === draftId ? { ...item, text: message.text ?? item.text } : item
              )
            )
          }
        }
        return
      }

      if (message.type === "assistant_interrupted") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        const draftId = streamingMessageIdRef.current
        if (!draftId) {
          return
        }
        const partialText = message.partialText ?? ""
        setMessages((previous) =>
          previous.map((item) =>
            item.id === draftId
              ? {
                  ...item,
                  text:
                    partialText.length > 0 && !partialText.includes("[Interrupted]")
                      ? `${partialText} [Interrupted]`
                      : partialText || `${item.text} [Interrupted]`,
                  interrupted: true,
                }
              : item
          )
        )
        setIsStreaming(false)
        setIsSendingMessage(false)
        return
      }

      if (message.type === "assistant_message") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        const text = message.text ?? ""
        if (text.length === 0) {
          return
        }

        const timestamp = message.timestamp ?? getNowTimestamp()
        const draftId = streamingMessageIdRef.current
        if (draftId) {
          setMessages((previous) =>
            previous.map((item) =>
              item.id === draftId
                ? { ...item, text, timestamp, interrupted: message.interrupted === true }
                : item
            )
          )
          streamingMessageIdRef.current = null
        } else {
          setMessages((previous) => [
            ...previous,
            createMessage("assistant", text, timestamp, message.interrupted === true),
          ])
        }

        setIsStreaming(false)
        setIsSendingMessage(false)
        upsertHistoryItem(activeSessionId, text.slice(0, 40), timestamp)
        return
      }

      if (message.type === "message_received") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        setIsSendingMessage(true)
        return
      }

      if (message.type === "joined") {
        if (!activeSessionId || message.sessionId !== activeSessionId) {
          return
        }
        setIsLoadingHistory(true)
        return
      }

      if (message.type === "error") {
        const reason = message.reason ?? message.text ?? "Realtime error"
        const details =
          typeof message.statusCode === "number"
            ? `${reason} (${message.statusCode})`
            : reason
        toast.error(details)
        setIsStreaming(false)
        setIsSendingMessage(false)
        return
      }
    }

    return () => {
      isCurrentConnection = false
      socketRef.current = null
      socket.close()
    }
  }, [activeSessionId, sendJoinEvent, upsertHistoryItem])

  useEffect(() => {
    if (socketState !== "open") {
      return
    }

    const timer = window.setInterval(() => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return
      }

      const payload: PingEventPayload = { type: "ping" }
      socket.send(JSON.stringify(payload))
    }, 25_000)

    return () => window.clearInterval(timer)
  }, [socketState])

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      setIsLoadingHistory(false)
      setIsStreaming(false)
      setIsSendingMessage(false)
      streamingMessageIdRef.current = null
      return
    }

    setIsLoadingHistory(true)
    bootstrapSession(activeSessionId)
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unable to load chat session"
        toast.error(message)
      })
      .finally(() => {
        setIsLoadingHistory(false)
      })
  }, [activeSessionId, bootstrapSession])

  const connectionLabel = useMemo(() => {
    if (socketState === "open") {
      return "Realtime: connected"
    }
    if (socketState === "error") {
      return "Realtime: error"
    }
    return "Realtime: closed"
  }, [socketState])

  return (
    <SidebarProvider>
      <AppSidebar
        user={user}
        history={history}
        onNewChat={onNewChat}
        isStartingChat={isStartingChat}
      />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{connectionLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4 pt-0">
          <ChatCenter
            sessionId={activeSessionId}
            messages={messages}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmit={onSendMessage}
            isConnected={socketState === "open"}
            isStreaming={isStreaming}
            isLoadingHistory={isLoadingHistory}
            isSending={isSendingMessage}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
