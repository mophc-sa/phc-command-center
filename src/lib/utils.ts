import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convert snake_case / underscore strings to Title Case. */
export function humanize(s: string | null | undefined): string {
  return (s ?? "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
