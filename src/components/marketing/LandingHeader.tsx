"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { ButtonLink } from "@/components/ui";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "/demos", label: "Demos" },
  { href: "#faq", label: "FAQ" },
  { href: "/terms", label: "Terms" },
] as const;

function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sectionIds = NAV_LINKS
      .filter((link) => link.href.startsWith("#"))
      .map((link) => link.href.slice(1));

    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActive(`#${visible[0].target.id}`);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return active;
}

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [overlayTop, setOverlayTop] = useState(0);
  const drawerRef = useRef<HTMLDivElement>(null);
  const headerBarRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstNavLinkRef = useRef<HTMLAnchorElement>(null);
  const prevOpenRef = useRef(false);
  const activeSection = useActiveSection();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    const bar = headerBarRef.current;
    if (!bar) return;

    function measure() {
      const el = headerBarRef.current;
      if (!el) return;
      setOverlayTop(el.getBoundingClientRect().height);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Focus: open → first nav link; close → menu button
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => firstNavLinkRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      menuButtonRef.current?.focus();
    }
    prevOpenRef.current = open;
  }, [open]);

  const mobileMenu =
    mounted && open ? (
      <div
        className="fixed left-0 right-0 bottom-0 z-[100] md:hidden"
        style={{ top: overlayTop }}
      >
        <button
          type="button"
          className="absolute inset-0 bg-landing-navy/92 cursor-pointer border-0 p-0"
          aria-label="Close menu"
          onClick={close}
        />
        <div
          id="landing-mobile-nav"
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="landing-mobile-nav-drawer absolute right-0 top-0 h-full w-72 max-w-[80vw] bg-landing-navy border-l border-landing-cream/10 shadow-2xl"
        >
          <nav className="flex flex-col p-6 gap-1">
            {NAV_LINKS.map((link, index) => (
              <Link
                key={link.href}
                ref={index === 0 ? firstNavLinkRef : undefined}
                href={link.href}
                onClick={close}
                className="px-4 py-3.5 min-h-[44px] flex items-center rounded-lg text-landing-cream/70 hover:text-landing-cream hover:bg-landing-cream/5 transition-colors text-base font-medium"
              >
                {link.label}
              </Link>
            ))}

            <div className="border-t border-landing-cream/10 mt-4 pt-4">
              <ButtonLink
                href="/auth/signup"
                variant="custom"
                className="w-full min-h-[44px] inline-flex items-center justify-center bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold text-center"
              >
                Get Started
              </ButtonLink>
            </div>
          </nav>
        </div>
      </div>
    ) : null;

  return (
    <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
      <div
        ref={headerBarRef}
        className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-2"
      >
        <Link href="#top" className="group flex items-center gap-2 sm:gap-2.5 min-w-0 shrink">
          <Image
            src="/TeamNetwor.png"
            alt=""
            width={541}
            height={303}
            sizes="28px"
            className="h-7 w-auto object-contain shrink-0"
            aria-hidden="true"
          />
          <span className="font-display text-[0.9375rem] sm:text-xl font-bold tracking-tight text-landing-cream truncate">
            <span className="text-landing-green">Team</span>
            <span className="text-landing-cream">Network</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition-colors ${
                activeSection === link.href
                  ? "nav-link-active"
                  : "text-landing-cream/70 hover:text-landing-cream"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <ButtonLink
            href="/auth/login"
            variant="custom"
            size="sm"
            className="whitespace-nowrap shrink-0 sm:px-4 sm:py-2.5 text-landing-cream/80 hover:text-landing-cream hover:bg-landing-cream/10"
          >
            Sign In
          </ButtonLink>
          <ButtonLink
            href="/auth/signup"
            variant="custom"
            className="max-sm:hidden bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold px-3 sm:px-5"
          >
            Get Started
          </ButtonLink>

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="md:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-landing-cream/70 hover:text-landing-cream hover:bg-landing-cream/10 transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileMenu && createPortal(mobileMenu, document.body)}
    </header>
  );
}
