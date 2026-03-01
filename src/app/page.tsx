import { Suspense } from "react"
import DashboardClient from "./dashboard/dashboard-client"

export default function HomePage() {
  return (
    <Suspense fallback={<div className="h-svh w-full bg-background" />}>
      <DashboardClient />
    </Suspense>
  )
}
