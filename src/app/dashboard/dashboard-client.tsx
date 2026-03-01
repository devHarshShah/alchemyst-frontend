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

const WS_RECONNECT_BASE_DELAY_MS = 1000
const WS_RECONNECT_MAX_DELAY_MS = 15000

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isPersistedHistory = (value: unknown): value is PersistedChatHistory =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.updatedAt === "string"

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

const parseRole = (value: unknown): ChatMessageRole =>
  value === "user" || value === "assistant" || value === "system"
    ? value
    : "assistant"

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

export default function DashboardClient() {
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
  const [sessionEndReasonById, setSessionEndReasonById] = useState<
    Record<string, string>
  >({})

  const socketRef = useRef<WebSocket | null>(null)
  const pendingJoinSessionIdRef = useRef<string | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(activeSessionId)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)

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

      setSessionEndReasonById((previous) => {
        if (!(sessionId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[sessionId]
        return next
      })

      upsertHistoryItem(sessionId, firstMessage.slice(0, 40) || "New chat", timestamp)
      sendJoinEvent(sessionId)
      router.push(`/dashboard?sessionId=${encodeURIComponent(sessionId)}`)

      setMessages(
        firstMessage.length > 0
          ? [createMessage("assistant", firstMessage, timestamp)]
          : []
      )

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

  const onSendMessage = useCallback(() => {
    if (!activeSessionId) {
      toast.error("Create or select a chat first")
      return
    }

    if (sessionEndReasonById[activeSessionId]) {
      toast.error("This session has ended. Start a new chat.")
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
  }, [activeSessionId, inputValue, sessionEndReasonById, upsertHistoryItem])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

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

    let isDisposed = false

    const clearReconnectTimer = (): void => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = (): void => {
      if (isDisposed) {
        return
      }

      const attempt = reconnectAttemptRef.current + 1
      reconnectAttemptRef.current = attempt
      const delay = Math.min(
        WS_RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
        WS_RECONNECT_MAX_DELAY_MS
      )

      clearReconnectTimer()
      reconnectTimerRef.current = window.setTimeout(() => {
        connectSocket()
      }, delay)
    }

    const handleWsMessage = (message: WsIncomingMessage): void => {
      const currentSessionId = activeSessionIdRef.current

      if (message.type === "history") {
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        if (!currentSessionId || message.sessionId !== currentSessionId) {
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
        upsertHistoryItem(currentSessionId, text.slice(0, 40), timestamp)
        return
      }

      if (message.type === "message_received") {
        if (!currentSessionId || message.sessionId !== currentSessionId) {
          return
        }
        setIsSendingMessage(true)
        return
      }

      if (message.type === "joined") {
        if (!currentSessionId || message.sessionId !== currentSessionId) {
          return
        }
        setIsLoadingHistory(true)
        return
      }

      if (message.type === "session_started") {
        if (!currentSessionId || message.sessionId !== currentSessionId) {
          return
        }
        setSessionEndReasonById((previous) => {
          if (!(currentSessionId in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[currentSessionId]
          return next
        })
        return
      }

      if (message.type === "session_ended") {
        if (!currentSessionId || message.sessionId !== currentSessionId) {
          return
        }
        const reason = message.reason?.trim() || "Session ended due to inactivity."
        setSessionEndReasonById((previous) => ({
          ...previous,
          [currentSessionId]: reason,
        }))
        setIsStreaming(false)
        setIsSendingMessage(false)
        toast.error(reason)
        return
      }

      if (message.type === "error") {
        const reason = message.reason ?? message.text ?? "Realtime error"
        const details =
          typeof message.statusCode === "number"
            ? `${reason} (${message.statusCode})`
            : reason
        toast.error(details)
        if (currentSessionId && message.statusCode === 409) {
          setSessionEndReasonById((previous) => ({
            ...previous,
            [currentSessionId]: reason,
          }))
        }
        setIsStreaming(false)
        setIsSendingMessage(false)
      }
    }

    const connectSocket = (): void => {
      if (isDisposed) {
        return
      }

      const socket = new WebSocket(getWebSocketUrl(token))
      socketRef.current = socket

      socket.onopen = () => {
        if (isDisposed) {
          return
        }

        clearReconnectTimer()
        reconnectAttemptRef.current = 0
        setSocketState("open")
        const initialSessionId =
          pendingJoinSessionIdRef.current ?? activeSessionIdRef.current
        if (initialSessionId) {
          sendJoinEvent(initialSessionId)
        }
      }

      socket.onerror = () => {
        if (isDisposed) {
          return
        }
        setSocketState("error")
      }

      socket.onclose = () => {
        if (isDisposed) {
          return
        }
        socketRef.current = null
        setSocketState("closed")
        setIsSendingMessage(false)
        setIsStreaming(false)
        scheduleReconnect()
      }

      socket.onmessage = (event: MessageEvent<string>) => {
        if (isDisposed) {
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

        handleWsMessage(message)
      }
    }

    connectSocket()

    return () => {
      isDisposed = true
      clearReconnectTimer()
      reconnectAttemptRef.current = 0
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
    }
  }, [sendJoinEvent, upsertHistoryItem])

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
    }, 25000)

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

  const activeSessionEndReason =
    activeSessionId ? sessionEndReasonById[activeSessionId] ?? null : null
  const isSessionEnded = activeSessionEndReason !== null

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
            onStartNewChat={onNewChat}
            isConnected={socketState === "open"}
            isStreaming={isStreaming}
            isLoadingHistory={isLoadingHistory}
            isSending={isSendingMessage}
            isSessionEnded={isSessionEnded}
            sessionEndReason={activeSessionEndReason}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
