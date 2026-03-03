"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SurfaceProps {
  children: ReactNode;
  /** Extra class names merged with the surface */
  className?: string;
  /** Visual variant: default window, or active (e.g. focused/selected) */
  variant?: "default" | "active";
  /** Add glass chrome (border/specular) on top of window style */
  chrome?: boolean;
  /** Render as this element */
  as?: "div" | "section" | "article";
}

/**
 * Shared surface for content windows (cards, Settings, Chat, Recall).
 * Uses the single .synthesis-window definition; radius and shadows come from CSS tokens.
 */
export function Surface({
  children,
  className,
  variant = "default",
  chrome = false,
  as: Component = "div",
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        "synthesis-window",
        chrome && "glass",
        variant === "active" && "synthesis-window--active",
        className
      )}
    >
      {children}
    </Component>
  );
}
