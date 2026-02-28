"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AppSidebar, type SidebarHistoryItem } from "@/components/app-sidebar"
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

interface PersistedChatHistory {
  id: string
  title: string
  updatedAt: string
}

type SocketState = "connecting" | "open" | "closed" | "error"

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

export default function Page() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [socketState, setSocketState] = useState<SocketState>("closed")
  const [history, setHistory] = useState<SidebarHistoryItem[]>([])

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
    let hasOpened = false

    const socket = new WebSocket(getWebSocketUrl(token))

    socket.onopen = () => {
      if (!isCurrentConnection) {
        return
      }
      hasOpened = true
      setSocketState("open")
      toast.success("Realtime connection established")
    }

    socket.onerror = () => {
      if (!isCurrentConnection || hasOpened) {
        return
      }
      setSocketState("error")
      toast.error("Realtime connection failed")
    }

    socket.onclose = () => {
      if (!isCurrentConnection) {
        return
      }
      setSocketState("closed")
    }

    return () => {
      isCurrentConnection = false
      socket.close()
    }
  }, [])

  const connectionLabel = useMemo(() => {
    if (socketState === "open") {
      return "Realtime: connected"
    }
    if (socketState === "connecting") {
      return "Realtime: connecting"
    }
    if (socketState === "error") {
      return "Realtime: error"
    }
    return "Realtime: closed"
  }, [socketState])

  return (
    <SidebarProvider>
      <AppSidebar user={user} history={history} />
      <SidebarInset>
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
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="bg-muted/50 rounded-xl p-6">
            <h2 className="text-xl font-semibold">Dashboard</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Welcome {user?.email ?? "user"}.
            </p>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
