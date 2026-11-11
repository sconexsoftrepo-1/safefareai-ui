"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronRight, Loader2, Mail, MailOpen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { alertService } from "@/features/drive-vision/api/alert-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import type { NotificationDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { usePolledQuery } from "@/features/drive-vision/hooks/use-polled-query";
import { formatLocalDateTime } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { ApiErrorState } from "../shared/api-states";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { toast } from "../shared/toast-provider";
import { HEADER_ICON } from "./header-styles";
import { canPerform, reachableHref } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { severityLabel } from "../alerts/alerts-model";
import { notificationHref, notificationTime, readNotificationPoll, type NotificationTab } from "./notifications-model";
import { canUseMaintenance, maintenanceTenant } from "@/features/drive-vision/access/maintenance-access";
import { maintenanceService } from "@/features/drive-vision/api/maintenance-service";
import { FeedNotes, MaintenanceList, MaintenanceReadNote } from "./maintenance-notifications";

const POLL_LIMIT = 20;
const PAGE_SIZE = 20;
/** Maintenance rows shown at the top of the All tab (the Maintenance tab has them all). */
const ALL_TAB_MAINTENANCE = 3;

/**
 * Header bell. GET /notifications/poll runs every 5 seconds while signed in (this component lives in the
 * authenticated shell) and feeds the badge and the AI Events and Alarm tabs; those tabs hold unread items only.
 * "See more" and the All tab use GET /notifications, which also has read items and the types the poll has no tab for
 * (a driver's dispatch and leave notices). Read-state changes re-poll at once. Links follow the user's role and are
 * dropped when the user can't open the target; read-state buttons need the `notifications.markRead` action.
 * The Safe-Fare Admin receives no notifications, so the backend answers empty and the panel says so.
 * Maintenance (Safe-Fare Admin and Fleet Owner only): Python vehicle / tyre maintenance alerts, aggregated per tenant
 * on the server (/api/maintenance/notifications) and fetched only while the popover shows them. They have no read
 * state: never in the unread badge, no Mark read buttons, Mark all read doesn't apply to them.
 */
export function NotificationCenter() {
  const router = useRouter();
  const access = useAccess();
  const canMark = canPerform(access, "notifications.markRead");
  const alertsHref = reachableHref(access, "/drive-vision/alerts?kind=incidents");
  const [open, setOpen] = useState(false);
  const [chosenTab, setChosenTab] = useState<NotificationTab | null>(null);
  const [seeMore, setSeeMore] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const maintenance = canUseMaintenance(access);
  const maintenanceScope = maintenanceTenant(access);

  const pollQ = usePolledQuery("notifications:poll", (signal) => alertService.pollNotifications(POLL_LIMIT, signal));
  const poll = useMemo(() => readNotificationPoll(pollQ.data), [pollQ.data]);
  const tab = chosenTab ?? (poll.ai.unread > 0 ? "AI_EVENT" : poll.alarm.unread > 0 ? "ALARM" : "ALL");
  const isMaintenance = tab === "MAINTENANCE";
  const fullList = !isMaintenance && (tab === "ALL" || seeMore);
  const listQ = useApiQuery(open && fullList ? `notifications:list:${tab}:${unreadOnly}:${page}` : null, () =>
    alertService.listNotifications({ type: tab === "ALL" ? undefined : tab, unreadOnly: unreadOnly || undefined, pageNumber: page, pageSize: PAGE_SIZE })
  );
  // Only while the popover shows maintenance rows (its tab, or page 1 of All), for users with a tenant to read.
  const showMaintenanceOnAll = maintenance && tab === "ALL" && page === 1 && !unreadOnly;
  const maintenanceQ = useApiQuery(open && maintenance && maintenanceScope.ok && (isMaintenance || showMaintenanceOnAll) ? `notifications:maintenance:${maintenanceScope.tenantId}` : null, () => maintenanceService.notifications(maintenanceScope.ok ? maintenanceScope.tenantId : null));
  const maintenanceItems = maintenanceQ.data?.items ?? [];
  const unread = pollQ.data ? poll.unreadTotal : undefined;
  const tabUnread = tab === "AI_EVENT" ? poll.ai.unread : tab === "ALARM" ? poll.alarm.unread : isMaintenance ? 0 : poll.unreadTotal;
  const items = fullList ? (listQ.data?.items ?? []) : tab === "AI_EVENT" ? poll.ai.items : poll.alarm.items;
  const total = listQ.data?.total ?? 0;

  function refresh() {
    pollQ.refetch();
    if (fullList) listQ.refetch();
  }

  function openMaintenance(href: string) {
    setOpen(false);
    router.push(href);
  }

  function chooseTab(next: NotificationTab) {
    setChosenTab(next);
    setSeeMore(false);
    setUnreadOnly(false);
    setPage(1);
  }

  async function mark(n: NotificationDto, read: boolean) {
    if (!canMark || n.id === undefined || busy !== null) return false;
    setBusy(n.id);
    try {
      await alertService.markNotification(n.id, read);
      return true;
    } catch (err) {
      toast.error("Couldn't update the notification", { description: describeApiError(err) });
      return false;
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function markAll() {
    // Maintenance alerts have no read state: "Mark all read" must never reach the BFF from that tab.
    if (!canMark || busy !== null || isMaintenance) return;
    setBusy("all");
    try {
      await alertService.markAllRead(tab === "ALL" ? undefined : tab);
    } catch (err) {
      toast.error("Couldn't mark all as read", { description: describeApiError(err) });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function openItem(n: NotificationDto) {
    const href = notificationHref(access, n);
    if (!href) return;
    if (!n.read && canMark && !(await mark(n, true))) return;
    setOpen(false);
    router.push(href);
  }

  const label = typeof unread === "number" ? `Notifications, ${unread} unread` : "Notifications";
  const emptyText = tab === "AI_EVENT" ? "No unread AI events." : tab === "ALARM" ? "No unread alarms." : "You're all caught up.";
  const maintenancePages = Math.max(1, Math.ceil(maintenanceItems.length / PAGE_SIZE));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setChosenTab(null);
          setSeeMore(false);
          setUnreadOnly(false);
          setPage(1);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={cn(HEADER_ICON, "relative")} aria-label={label} title={pollQ.error ? `Notifications may be out of date: ${describeApiError(pollQ.error)}` : undefined} data-testid="notification-bell">
          <Bell className="size-[17px]" />
          {typeof unread === "number" && unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] leading-[18px] font-semibold text-white tabular" aria-hidden data-testid="notification-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={14} collisionPadding={16} className="w-[min(400px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Notifications
            {typeof unread === "number" ? <span className="ml-1.5 text-xs font-normal text-ink-muted">{unread} unread</span> : null}
          </p>
          {canMark ? (
            <button type="button" onClick={markAll} disabled={busy !== null || tabUnread === 0 || isMaintenance} title={isMaintenance ? "Maintenance alerts have no read state" : undefined} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50" data-testid="notification-read-all">
              {busy === "all" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />} Mark all read
            </button>
          ) : null}
        </div>
        <div role="tablist" aria-label="Notification type" className="flex gap-1 border-b border-line px-3 py-2">
          <TabButton label="AI Events" count={poll.ai.unread} active={tab === "AI_EVENT"} onClick={() => chooseTab("AI_EVENT")} />
          <TabButton label="Alarm" count={poll.alarm.unread} active={tab === "ALARM"} onClick={() => chooseTab("ALARM")} />
          {maintenance ? <TabButton label="Maintenance" active={isMaintenance} onClick={() => chooseTab("MAINTENANCE")} /> : null}
          <TabButton label="All" active={tab === "ALL"} onClick={() => chooseTab("ALL")} />
        </div>
        {pollQ.stale ? (
          <p className="border-b border-line bg-warning-soft px-4 py-1.5 text-[11.5px] text-warning" role="status" data-testid="notification-stale">
            Couldn&apos;t refresh. Showing the last update{pollQ.updatedAt ? ` from ${formatLocalDateTime(new Date(pollQ.updatedAt))}` : ""}.
          </p>
        ) : null}
        {isMaintenance ? <MaintenanceReadNote /> : null}
        {(isMaintenance || showMaintenanceOnAll) && maintenanceQ.data ? <FeedNotes feed={maintenanceQ.data} /> : null}
        <div className="scrollbar-thin max-h-[55vh] overflow-y-auto" role="tabpanel">
          {isMaintenance ? (
            !maintenanceScope.ok ? (
              <EmptyState icon={Bell} title="Select a tenant" description="Maintenance alerts belong to one organisation. Choose a tenant in the header to see them." className="py-8" />
            ) : maintenanceQ.error && !maintenanceQ.data ? (
              <ApiErrorState error={maintenanceQ.error} onRetry={maintenanceQ.refetch} compact title="Couldn't load maintenance alerts" />
            ) : !maintenanceQ.data ? (
              <LoadingSkeleton variant="list" rows={4} />
            ) : (
              <MaintenanceList items={maintenanceItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} access={access} onOpen={openMaintenance} />
            )
          ) : (
            <>
              {showMaintenanceOnAll && maintenanceScope.ok && maintenanceItems.length > 0 ? (
                <section aria-label="Maintenance" className="border-b border-line" data-testid="all-tab-maintenance">
                  <p className="flex items-center justify-between px-4 pt-2.5 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">
                    Maintenance
                    <button type="button" onClick={() => chooseTab("MAINTENANCE")} className="rounded-lg px-1.5 py-0.5 text-[11px] font-medium tracking-normal text-ink-muted normal-case hover:bg-surface-muted hover:text-ink">
                      View all ({maintenanceItems.length})
                    </button>
                  </p>
                  <MaintenanceList items={maintenanceItems.slice(0, ALL_TAB_MAINTENANCE)} access={access} onOpen={openMaintenance} />
                </section>
              ) : showMaintenanceOnAll && maintenanceScope.ok && maintenanceQ.error ? (
                <p className="border-b border-line px-4 py-2 text-[11.5px] text-ink-muted" role="status" data-testid="all-tab-maintenance-error">
                  Maintenance alerts couldn&apos;t be loaded: {describeApiError(maintenanceQ.error)}
                </p>
              ) : null}
          {pollQ.error && !pollQ.data && !fullList ? (
            <ApiErrorState error={pollQ.error} onRetry={pollQ.refetch} compact />
          ) : fullList && listQ.error && !listQ.data ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} compact />
          ) : !(fullList ? listQ.data : pollQ.data) ? (
            <LoadingSkeleton variant="list" rows={4} />
          ) : items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description={emptyText} className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n, i) => {
                const href = notificationHref(access, n);
                return (
                  <li key={n.id ?? i} className={cn("flex items-start gap-2 px-4 py-3", !n.read && "bg-brand-tint/40")} data-notification={n.id}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                    {/* Without a reachable destination the item is plain text, not a dead button. */}
                    {href ? (
                      <button type="button" onClick={() => void openItem(n)} disabled={busy !== null} className="min-w-0 flex-1 text-left">
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
                        onClick={() => void mark(n, !n.read)}
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
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line p-1.5">
          {isMaintenance ? (
            <span className="flex items-center gap-1 px-1 text-xs text-ink-muted">
              <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="rounded-lg px-2 py-1 font-medium hover:bg-surface-muted hover:text-ink disabled:opacity-50">
                Previous
              </button>
              <span className="tabular">
                Page {page} of {maintenancePages}
              </span>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= maintenancePages} className="rounded-lg px-2 py-1 font-medium hover:bg-surface-muted hover:text-ink disabled:opacity-50">
                Next
              </button>
            </span>
          ) : fullList ? (
            <>
              <label className="flex items-center gap-1.5 px-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--dv-brand)]"
                  checked={unreadOnly}
                  onChange={(e) => {
                    setUnreadOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                Unread only
              </label>
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="rounded-lg px-2 py-1 font-medium hover:bg-surface-muted hover:text-ink disabled:opacity-50">
                  Previous
                </button>
                <span className="tabular">Page {page}</span>
                <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= total} className="rounded-lg px-2 py-1 font-medium hover:bg-surface-muted hover:text-ink disabled:opacity-50">
                  Next
                </button>
              </span>
            </>
          ) : (
            <button type="button" onClick={() => setSeeMore(true)} className="rounded-xl px-2.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-muted" data-testid="notification-see-more">
              See more
            </button>
          )}
          {alertsHref ? (
            <Link href={alertsHref} onClick={() => setOpen(false)} className="ml-auto flex items-center gap-1 rounded-xl px-2.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
              Open Alerts &amp; Events <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Link>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium", active ? "bg-ink text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink")} data-tab={label}>
      {label}
      {count ? <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular", active ? "bg-white/20 text-white" : "bg-brand-soft text-brand-deep")}>{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}

function NotificationText({ n }: { n: NotificationDto }) {
  const time = notificationTime(n);
  return (
    <>
      <span className="block text-[13px] font-medium text-ink">{n.title ?? n.type ?? "Notification"}</span>
      {n.body ? <span className="mt-0.5 block text-xs text-ink-muted">{n.body}</span> : null}
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
        {time ? <time dateTime={time.iso}>{time.text}</time> : null}
        {typeof n.severity === "number" ? <span>{severityLabel(n.severity)}</span> : null}
      </span>
      <span className="sr-only">{n.read ? "Read" : "Unread"}</span>
    </>
  );
}
