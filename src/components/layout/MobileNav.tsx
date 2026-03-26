"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { OrgSidebar } from "./OrgSidebar";
import type { Organization } from "@/types/database";
import type { OrgRole } from "@/lib/auth/role-utils";

interface MobileNavProps {
  organization: Organization;
  role: OrgRole | null;
  isDevAdmin?: boolean;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
  currentMemberId?: string;
  currentMemberName?: string;
  currentMemberAvatar?: string | null;
}

const MOBILE_DRAWER_ID = "org-mobile-drawer";

export function MobileNav({ organization, role, isDevAdmin = false, hasAlumniAccess = false, hasParentsAccess = false, currentMemberId, currentMemberName, currentMemberAvatar }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasEverOpened, setHasEverOpened] = useState(false);
  const [mounted, setMounted] = useState(false);
  const basePath = `/${organization.slug}`;
  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setHasEverOpened(true);
  }, [isOpen]);

  const drawerAndOverlay =
    mounted ? (
      <>
        {isOpen && (
          <button
            type="button"
            className="fixed inset-0 z-[55] cursor-pointer border-0 bg-background/85 p-0 backdrop-blur-sm lg:hidden"
            aria-label="Close menu"
            onClick={closeMenu}
          />
        )}
        <div
          id={MOBILE_DRAWER_ID}
          role="dialog"
          aria-modal="true"
          aria-label="Organization navigation"
          className={`fixed bottom-0 left-0 top-0 z-[60] w-[min(18rem,88vw)] transform overscroll-contain border-r border-border bg-card transition-transform duration-300 ease-in-out lg:hidden ${
            isOpen ? "translate-x-0 shadow-xl" : "-translate-x-full pointer-events-none"
          }`}
        >
          {hasEverOpened && (
            <OrgSidebar
              organization={organization}
              role={role}
              isDevAdmin={isDevAdmin}
              hasAlumniAccess={hasAlumniAccess}
              hasParentsAccess={hasParentsAccess}
              currentMemberId={currentMemberId}
              currentMemberName={currentMemberName}
              currentMemberAvatar={currentMemberAvatar}
              className="h-full max-h-dvh border-0 pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)]"
              onClose={closeMenu}
            />
          )}
        </div>
      </>
    ) : null;

  return (
    <>
      {/* Top Bar (Mobile Only) — z above AI edge tab (z-44) */}
      <header className="lg:hidden fixed left-0 right-0 top-0 z-[46] flex min-h-[calc(4rem+env(safe-area-inset-top,0px))] items-center justify-between border-b border-border bg-card px-4 pt-[env(safe-area-inset-top,0px)]">
        <Link href={basePath} className="flex items-center gap-3 min-w-0">
          {organization.logo_url ? (
            <div className="relative h-8 w-8 rounded-lg overflow-hidden">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                fill
                className="object-cover"
                sizes="32px"
              />
            </div>
          ) : (
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: "var(--color-org-primary)" }}
            >
              {organization.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <span className="font-semibold text-foreground truncate max-w-[200px] block">{organization.name}</span>
            {isDevAdmin && (
              <span className="text-[10px] uppercase tracking-wide text-purple-400 block">Dev Admin</span>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMenu}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            aria-expanded={isOpen}
            aria-controls={MOBILE_DRAWER_ID}
            aria-label={isOpen ? "Close menu" : "Open menu"}
          >
            {isOpen ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {drawerAndOverlay && createPortal(drawerAndOverlay, document.body)}
    </>
  );
}
