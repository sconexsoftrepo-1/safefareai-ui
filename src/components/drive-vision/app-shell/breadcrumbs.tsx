"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV_GROUPS, findNavItem } from "../navigation/nav-config";

export function Breadcrumbs() {
  const pathname = usePathname();
  const item = findNavItem(pathname);
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.href === item?.href));

  const crumbs: { label: string; href?: string }[] = [];
  if (group && group.label !== "Overview") crumbs.push({ label: group.label });
  if (item) crumbs.push({ label: item.label, href: item.href });

  if (item && pathname !== item.href) {
    const rest = pathname.slice(item.href.length + 1);
    if (rest === "new") crumbs.push({ label: "Add vehicle" });
    // The device name is the page title; the crumb stays generic so it needs no extra lookup.
    else if (item.href.endsWith("/vehicles")) crumbs.push({ label: "Vehicle details" });
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={last ? "min-w-0 truncate" : "hidden shrink-0 items-center gap-1 sm:flex"}>
              {c.href && !last ? (
                <Link href={c.href} className="text-ink-muted hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={last ? "truncate font-semibold text-ink" : "text-ink-muted"} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRight className="size-3.5 text-ink-subtle" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
