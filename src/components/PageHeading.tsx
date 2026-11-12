import type { ReactNode } from "react";

/** Shared clubhouse heading; accepts public display content only. */
export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="page-heading">
    <p className="eyebrow">The clubhouse / {eyebrow}</p>
    <h1>{title}</h1>
    {children && <div className="page-heading-description">{children}</div>}
  </header>;
}
