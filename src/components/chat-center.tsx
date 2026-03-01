"use client"

import { FormEvent, useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/chat"

interface ChatCenterProps {
  sessionId: string | null
  messages: ChatMessage[]
  inputValue: string
  onInputChange: (value: string) => void
  onSubmit: () => void
  onStartNewChat: () => void
  isConnected: boolean
  isStreaming: boolean
  isLoadingHistory: boolean
  isSending: boolean
  isSessionEnded: boolean
  sessionEndReason: string | null
}

const formatTimestamp = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ChatCenter({
  sessionId,
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  onStartNewChat,
  isConnected,
  isStreaming,
  isLoadingHistory,
  isSending,
  isSessionEnded,
  sessionEndReason,
}: ChatCenterProps) {
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isStreaming])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-background">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <p className="text-sm font-medium">Active chat</p>
          <p className="text-xs text-muted-foreground">
            {sessionId ?? "No session selected"}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                isConnected ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            {isConnected ? "Connected" : "Offline"}
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                isStreaming ? "bg-blue-500" : "bg-muted-foreground"
              )}
            />
            {isStreaming ? "Assistant typing" : "Idle"}
          </span>
          {isSessionEnded ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              Session ended
            </span>
          ) : null}
        </div>
      </div>

      <div ref={scrollViewportRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoadingHistory ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading messages...
          </div>
        ) : null}

        {!isLoadingHistory && messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Start a new chat or pick one from history.
          </p>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2",
              message.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted"
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] opacity-80">
              <span className="uppercase">{message.role}</span>
              <span>{formatTimestamp(message.timestamp)}</span>
            </div>
            <div className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background/60 [&_pre]:p-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.text}
              </ReactMarkdown>
            </div>
            {message.interrupted ? (
              <p className="mt-1 text-[11px] font-medium text-amber-600">
                Interrupted
              </p>
            ) : null}
          </div>
        ))}

        {isStreaming ? (
          <div className="w-fit rounded-lg bg-muted px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:120ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:240ms]" />
            </div>
          </div>
        ) : null}
      </div>

      {isSessionEnded ? (
        <div className="border-t bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Session ended</p>
          <p className="mt-1 text-xs text-amber-700">
            {sessionEndReason ?? "This chat was ended due to inactivity."}
          </p>
          <Button className="mt-3" size="sm" onClick={onStartNewChat}>
            Start new chat
          </Button>
        </div>
      ) : null}

      <form onSubmit={submitForm} className="border-t bg-background p-4">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={
              isSessionEnded
                ? "Session ended. Start a new chat."
                : sessionId
                  ? "Type your message..."
                  : "Create or select a chat first"
            }
            disabled={!sessionId || isSessionEnded}
          />
          <Button
            type="submit"
            disabled={!sessionId || isSessionEnded || !inputValue.trim()}
          >
            {isSending ? "Sending..." : "Send"}
          </Button>
        </div>
      </form>
    </div>
  )
}
