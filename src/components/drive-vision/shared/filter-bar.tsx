"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { transitions } from "./motion";

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-full border border-line/80 bg-surface pr-9 pl-10 shadow-[0_1px_2px_rgb(31_30_38/0.04)] transition-[border-color,box-shadow] duration-150 ease-dv text-sm text-ink outline-none placeholder:text-ink-subtle hover:border-line-strong focus-visible:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:outline-none"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function FilterSelect<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger aria-label={label} className={cn("min-w-36 rounded-full border-line/80 bg-surface pl-4", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Pill-style segmented control with an animated selection surface. */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: React.ReactNode; count?: number }[];
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line/70 bg-surface p-1 shadow-[0_1px_2px_rgb(31_30_38/0.04)] scrollbar-none", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]",
              active ? "text-white" : "text-ink-muted hover:text-ink"
            )}
          >
            {active ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-ink" transition={transitions.layout} /> : null}
            <span className="relative">{o.label}</span>
            {o.count !== undefined ? (
              <span className={cn("relative rounded-full px-1.5 text-[11px] tabular", active ? "bg-white/20" : "bg-surface-sunken")}>{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
