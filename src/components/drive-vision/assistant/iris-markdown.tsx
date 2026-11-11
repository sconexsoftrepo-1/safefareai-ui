"use client";

import Link from "next/link";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeIrisHref } from "./iris-chat-model";

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-[15px] font-semibold text-ink first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold text-ink first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2.5 mb-1 text-[13.5px] font-semibold text-ink first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-2.5 mb-1 text-[13px] font-semibold text-ink first:mt-0">{children}</h6>,
  h5: ({ children }) => <h6 className="mt-2 mb-1 text-[13px] font-semibold text-ink first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-[13px] font-medium text-ink first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-4 first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-4 first:mt-0">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-powder-strong pl-2.5 text-ink-muted first:mt-0">{children}</blockquote>,
  hr: () => <hr className="my-3 border-line" />,
  // Wide tables and code scroll inside the bubble, so the panel never overflows sideways.
  table: ({ children }) => (
    <div className="scrollbar-thin mt-2 max-w-full overflow-x-auto rounded-lg border border-line bg-surface first:mt-0" tabIndex={0} role="region" aria-label="Table">
      <table className="w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th className="border-b border-line bg-surface-muted px-2.5 py-1.5 font-semibold whitespace-nowrap" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="border-b border-line px-2.5 py-1.5 align-top" style={style}>
      {children}
    </td>
  ),
  pre: ({ children }) => <pre className="scrollbar-thin mt-2 max-w-full overflow-x-auto rounded-lg bg-ink p-2.5 font-mono text-[12px] leading-relaxed text-white first:mt-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>,
  code: ({ children, className }) => <code className={`rounded bg-surface px-1 py-0.5 font-mono text-[12px] text-ink ${className ?? ""}`}>{children}</code>,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    const className = "font-medium break-words text-ai-ink underline underline-offset-2";
    if (href.startsWith("/")) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className}>
        {children}
      </a>
    );
  },
  // Images would load from any host the answer names, so only their description is shown.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

/**
 * An assistant message as Markdown. Output is built as React elements, so text is escaped; raw HTML in the
 * source is dropped (no rehype-raw), and every link passes safeIrisHref.
 */
export function IrisMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeIrisHref} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}
