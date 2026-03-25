"use client";

export function LocalDate({ iso, options }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const date = new Date(iso);
  return <>{date.toLocaleDateString("en-US", options)}</>;
}

export function LocalTime({ iso, options }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const date = new Date(iso);
  return <>{date.toLocaleTimeString("en-US", options ?? { hour: "numeric", minute: "2-digit" })}</>;
}

export function LocalDateDay({ iso }: { iso: string }) {
  return <>{new Date(iso).getDate()}</>;
}

export function LocalDateMonth({ iso }: { iso: string }) {
  return <>{new Date(iso).toLocaleDateString("en-US", { month: "short" })}</>;
}
