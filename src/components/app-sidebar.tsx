"use client"

import * as React from "react"
import { MessageCircle } from "lucide-react"

import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { AuthUser } from "@/lib/auth"

export interface SidebarHistoryItem {
  id: string
  title: string
  url: string
  updatedAt: string
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: AuthUser | null
  history: SidebarHistoryItem[]
}

export function AppSidebar({ user, history, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <MessageCircle className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Alchemyst</span>
                <span className="truncate text-xs">AI Chat</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavProjects history={history} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: user?.email ?? "Guest",
            email: user?.email ?? "Not signed in",
            avatar: "",
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
