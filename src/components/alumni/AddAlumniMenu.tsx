"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface AddAlumniMenuProps {
  orgSlug: string;
  organizationId: string;
  actionLabel: string;
  onImportClick: () => void;
}

const SHARED_BUTTON =
  "inline-flex items-center justify-center text-sm font-medium bg-org-secondary text-org-secondary-foreground hover:opacity-90 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-org-secondary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-pointer";

export function AddAlumniMenu({ orgSlug, actionLabel, onImportClick }: AddAlumniMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    },
    [],
  );

  return (
    <div ref={menuRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Split button — single rounded-xl container, two buttons inside */}
      <div className="flex items-stretch rounded-xl overflow-hidden">
        <button
          className={`${SHARED_BUTTON} gap-2 px-4 py-2.5`}
          onClick={() => router.push(`/${orgSlug}/alumni/new`)}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {actionLabel}
        </button>

        <div className="w-px bg-white/20" />

        <button
          className={`${SHARED_BUTTON} px-2.5 py-2.5`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label="More add options"
        >
          <svg
            className={`h-4 w-4 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-card border border-border shadow-lg z-20 overflow-hidden animate-fade-in"
        >
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              router.push(`/${orgSlug}/alumni/new`);
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
            </svg>
            Add Single Alumni
          </button>
          <div className="border-t border-border" />
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors duration-150 flex items-center gap-3"
            onClick={() => {
              setIsOpen(false);
              onImportClick();
            }}
          >
            <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Import LinkedIn CSV
          </button>
        </div>
      )}
    </div>
  );
}
