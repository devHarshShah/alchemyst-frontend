"use client"

import Link from "next/link"
import { MessageSquareText } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavProjects({
  history,
}: {
  history: {
    id: string
    title: string
    url: string
    updatedAt: string
  }[]
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chat History</SidebarGroupLabel>
      <SidebarMenu>
        {history.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton asChild>
              <Link href={item.url}>
                <MessageSquareText />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.updatedAt}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        {history.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton className="text-sidebar-foreground/70" disabled>
              <MessageSquareText className="text-sidebar-foreground/70" />
              <span>No chats yet</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  )
}
