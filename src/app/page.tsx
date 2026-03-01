import { Suspense } from "react"
import type { Metadata } from "next"
import DashboardClient from "./dashboard/dashboard-client"

export const metadata: Metadata = {
  title: "Chat",
  description: "Realtime AI chat with streaming responses and saved sessions.",
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="h-svh w-full bg-background" />}>
      <DashboardClient />
    </Suspense>
  )
}
