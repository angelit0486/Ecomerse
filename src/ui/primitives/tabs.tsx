"use client";

import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Pestañas accesibles (flechas para moverse, roles tablist/tab/tabpanel). */
export function Tabs({
  label,
  tabs,
  defaultValue,
}: {
  label: string;
  tabs: ReadonlyArray<{ value: string; label: string; content: ReactNode }>;
  defaultValue?: string;
}) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value}>
      <T.List aria-label={label} className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <T.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-fg-muted",
              "data-[state=active]:border-accent data-[state=active]:text-fg",
              "focus-visible:outline-2 focus-visible:outline-focus",
            )}
          >
            {tab.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((tab) => (
        <T.Content key={tab.value} value={tab.value} className="pt-4 focus:outline-none">
          {tab.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
