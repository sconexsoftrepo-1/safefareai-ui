"use client";

import Link from "next/link";
import { ChevronDown, LifeBuoy, LogOut, Settings, UsersRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useAuth } from "@/features/drive-vision/store/auth-store";
import { initials } from "@/features/drive-vision/utils/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HEADER_PILL } from "./header-styles";

/**
 * Profile menu. `pill` = topbar profile pill (reference: avatar, name, email, chevron —
 * details collapse to the avatar on narrow headers); `header` = compact avatar for mobile.
 */
export function UserProfileMenu({ variant = "header" }: { variant?: "header" | "pill" }) {
  // Signed-in user from GET /me (the shell only renders behind AuthGate).
  const user = useAuth((s) => s.user);
  const name = user?.displayName || user?.email || "Signed-in user";
  const roleLabel = user?.role?.description || user?.role?.code;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "pill" ? (
          <button
            type="button"
            className={cn(
              HEADER_PILL,
              "gap-2.5 pr-1.5 pl-1.5 transition-[box-shadow] duration-150 hover:shadow-hover focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none @min-[1120px]:pr-3.5"
            )}
            aria-label="Open profile menu"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-peach text-[12px] font-semibold text-brand-deep">{initials(name)}</span>
            <span className="hidden min-w-0 text-left leading-tight @min-[1120px]:block">
              <span className="block max-w-[140px] truncate text-[13px] font-semibold text-ink">{name}</span>
              <span className="block max-w-[140px] truncate text-[11px] text-ink-muted">{user?.email ?? roleLabel ?? user?.tenantName}</span>
            </span>
            <ChevronDown className="hidden size-4 text-ink-subtle @min-[1120px]:block" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line/60 bg-surface shadow-card transition-[box-shadow] duration-150 hover:shadow-hover focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none"
            aria-label="Open profile menu"
          >
            <span className="grid size-8 place-items-center rounded-full bg-peach text-[12px] font-semibold text-brand-deep">{initials(name)}</span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" sideOffset={12} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="text-[13px] font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-ink-muted">{user?.email}</p>
          {roleLabel || user?.tenantName ? (
            <p className="mt-0.5 truncate text-[11px] text-ink-subtle">{[roleLabel, user?.tenantName].filter(Boolean).join(" · ")}</p>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/drive-vision/settings">
            <Settings /> Profile & preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/drive-vision/users">
            <UsersRound /> Users & sub-accounts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toast.info("SafeFare AI demo", { description: "This workspace uses sample data only. Support links will be added with backend integration." })}>
          <LifeBuoy /> About this demo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
