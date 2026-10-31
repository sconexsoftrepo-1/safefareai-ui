"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronRight, Loader2, Mail, MailOpen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { alertService } from "@/features/drive-vision/api/alert-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import type { NotificationDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatRelative } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { ApiErrorState } from "../shared/api-states";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { toast } from "../shared/toast-provider";
import { HEADER_ICON } from "./header-styles";
import { canPerform, reachableHref } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { notificationLink } from "./search-model";

const PAGE_SIZE = 20;

/**
 * Header bell on GET /notifications and /notifications/unread-count. The count is read once per
 * page load and again whenever the panel closes (no polling); the list loads only while the panel
 * is open. Read state changes are sent per item or with "Mark all read", and the list and count
 * are re-read from the server afterwards. Links follow the user's role (driver notifications open
 * My Work screens) and are dropped when the user can't open the target; read-state buttons need the
 * `notifications.markRead` action.
 */
export function NotificationCenter() {
  const router = useRouter();
  const access = useAccess();
  const canMark = canPerform(access, "notifications.markRead");
  const alertsHref = reachableHref(access, "/drive-vision/alerts?kind=incidents");
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const countQ = useApiQuery(`notifications:count:${version}`, () => alertService.unreadCount());
  const listQ = useApiQuery(open ? `notifications:list:${version}` : null, () => alertService.listNotifications({ pageNumber: 1, pageSize: PAGE_SIZE }));
  const unread = countQ.data;
  const items = listQ.data?.items ?? [];
  const refresh = () => setVersion((v) => v + 1);

  async function mark(n: NotificationDto, read: boolean) {
    if (!canMark || n.id === undefined || busy !== null) return;
    setBusy(n.id);
    try {
      await alertService.markNotification(n.id, read);
      refresh();
    } catch (err) {
      toast.error("Couldn't update the notification", { description: describeApiError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    if (!canMark || busy !== null) return;
    setBusy("all");
    try {
      await alertService.markAllRead();
      refresh();
    } catch (err) {
      toast.error("Couldn't mark all as read", { description: describeApiError(err) });
    } finally {
      setBusy(null);
    }
  }

  function openItem(n: NotificationDto) {
    const href = notificationLink(access, n.refType, n.refId);
    if (!href) return;
    if (!n.read) void mark(n, true);
    setOpen(false);
    router.push(href);
  }

  const label = typeof unread === "number" ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={cn(HEADER_ICON, "relative")} aria-label={label} title={countQ.error ? `Unread count unavailable: ${describeApiError(countQ.error)}` : undefined}>
          <Bell className="size-[17px]" />
          {typeof unread === "number" && unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] leading-[18px] font-semibold text-white tabular" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={14} className="w-[min(400px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Notifications
            {typeof unread === "number" ? <span className="ml-1.5 text-xs font-normal text-ink-muted">{unread} unread</span> : null}
          </p>
          {canMark ? (
            <button
              type="button"
              onClick={markAll}
              disabled={busy !== null || !items.some((n) => !n.read)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"
            >
              {busy === "all" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />} Mark all read
            </button>
          ) : null}
        </div>
        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
          {listQ.error && !listQ.data ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} compact />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="list" rows={4} />
          ) : items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description="You're all caught up." className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n, i) => {
                const href = notificationLink(access, n.refType, n.refId);
                return (
                  <li key={n.id ?? i} className={cn("flex items-start gap-2 px-4 py-3", !n.read && "bg-brand-tint/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                    {/* Without a reachable destination the item is plain text, not a dead button. */}
                    {href ? (
                      <button type="button" onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                        <NotificationText n={n} />
                      </button>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <NotificationText n={n} />
                      </div>
                    )}
                    {canMark ? (
                    <button
                      type="button"
                      onClick={() => mark(n, !n.read)}
                      disabled={busy !== null || n.id === undefined}
                      className="shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"
                      aria-label={n.read ? "Mark as unread" : "Mark as read"}
                      title={n.read ? "Mark as unread" : "Mark as read"}
                    >
                      {busy === n.id ? <Loader2 className="size-3.5 animate-spin" /> : n.read ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
                    </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {alertsHref ? (
          <div className="border-t border-line p-1.5">
            <Link href={alertsHref} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
              Open Alerts &amp; Events <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function NotificationText({ n }: { n: NotificationDto }) {
  return (
    <>
      <span className="block text-[13px] font-medium text-ink">{n.title ?? n.type ?? "Notification"}</span>
      {n.body ? <span className="mt-0.5 block text-xs text-ink-muted">{n.body}</span> : null}
      {n.createdAt ? (
        <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="mt-0.5 block text-[11px] text-ink-subtle">
          {formatRelative(n.createdAt, new Date())}
        </time>
      ) : null}
      <span className="sr-only">{n.read ? "Read" : "Unread"}</span>
    </>
  );
}
