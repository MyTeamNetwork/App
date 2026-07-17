"use client";

import { useEffect, useState } from "react";

/**
 * Drives a mount/unmount cycle around CSS transitions so dismissable
 * surfaces (drawers, side panels) can animate out before unmounting.
 *
 * - `mounted` — whether to render the surface at all.
 * - `visible` — whether to apply the "open" transition classes. Flips one
 *   frame after mount so the closed → open transition actually plays.
 *
 * Transitions (unlike keyframes) retarget smoothly, so rapid open/close
 * toggles stay interruptible.
 */
export function useDrawerTransition(open: boolean, exitDurationMs = 250) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Double rAF: the first frame paints the closed state, the second
      // starts the transition. A single rAF can land in the same paint.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setVisible(false);
    const timeout = setTimeout(() => setMounted(false), exitDurationMs);
    return () => clearTimeout(timeout);
  }, [open, exitDurationMs]);

  return { mounted, visible };
}
