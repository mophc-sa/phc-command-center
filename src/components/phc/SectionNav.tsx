import { useCallback, useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, List } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import {
  activeSectionIndex,
  isOwnedTarget,
  MIN_SECTIONS_FOR_INDEX,
  sectionStepFor,
  stepTarget,
} from "@/lib/section-nav";

// The sticky header (h-12) plus a little air, so a section lands under it
// rather than behind it.
const READING_OFFSET = 64;

/**
 * The page's sections: the outermost <section> elements in the main column.
 *
 * Panel already renders one, with its title in a heading, and the Command
 * Center's blocks are sections too -- so no page has to be marked up for this.
 * A panel inside a panel is part of its parent, not a stop of its own.
 */
function findSections(): HTMLElement[] {
  const main = document.getElementById("main-content");
  if (!main) return [];
  return Array.from(main.querySelectorAll<HTMLElement>("section")).filter((el) => {
    if (el.parentElement?.closest("section")) return false;
    return el.getClientRects().length > 0;
  });
}

function sectionTitle(el: HTMLElement, n: number, lang: string): string {
  const label = el.getAttribute("aria-label");
  if (label) return label;
  const by = el.getAttribute("aria-labelledby");
  const labelled = by ? document.getElementById(by)?.textContent?.trim() : "";
  if (labelled) return labelled;
  const heading = el.querySelector("h1, h2, h3, h4")?.textContent?.trim();
  if (heading) return heading;
  return lang === "ar" ? `القسم ${n}` : `Section ${n}`;
}

const tops = (els: HTMLElement[]) => els.map((el) => el.getBoundingClientRect().top + window.scrollY);
const readingLine = () => window.scrollY + READING_OFFSET;

function goTo(el: HTMLElement) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({
    top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - READING_OFFSET + 8),
    behavior: reduce ? "auto" : "smooth",
  });
  // Focus follows, so a screen reader announces where the jump landed and Tab
  // continues from there. The section is made focusable only for this.
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
    el.style.outline = "none";
  }
  el.focus({ preventScroll: true });
}

/**
 * ⌥↑ / ⌥↓ between the sections of a long page, and a small index of them.
 * See section-nav.ts for why it is not the bare arrows.
 */
export function SectionNav() {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [sections, setSections] = useState<HTMLElement[]>([]);
  const [active, setActive] = useState(-1);

  // Sections come and go: data loads in, the deal page's timeline filter
  // shows and hides panels. Re-read on any change to the main column, at most
  // once a frame.
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    let frame = 0;
    const rescan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = findSections();
        setSections((prev) =>
          prev.length === found.length && prev.every((el, i) => el === found[i]) ? prev : found,
        );
      });
    };
    rescan();
    const observer = new MutationObserver(rescan);
    observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // At the very bottom the last short sections can never reach the
        // reading line; the last one is the one on screen.
        const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        setActive(atEnd && sections.length ? sections.length - 1 : activeSectionIndex(tops(sections), readingLine()));
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  const step = useCallback(
    (dir: "next" | "prev") => {
      const i = stepTarget(tops(sections), readingLine(), dir);
      if (i >= 0) goTo(sections[i]);
    },
    [sections],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = sectionStepFor(e);
      if (!dir || sections.length < 2) return;
      if (isOwnedTarget(e.target as Element | null)) return;
      e.preventDefault();
      step(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections, step]);

  if (sections.length < MIN_SECTIONS_FOR_INDEX) return null;

  const ar = lang === "ar";
  const current = Math.max(active, 0);
  const pill =
    "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";

  return (
    <nav
      aria-label={ar ? "أقسام الصفحة" : "Page sections"}
      className="fixed bottom-5 end-5 z-20 hidden items-center gap-0.5 rounded-full border border-border bg-surface/95 p-1 shadow-elevated backdrop-blur md:flex print:hidden"
    >
      <button
        type="button"
        className={pill}
        onClick={() => step("prev")}
        disabled={current === 0}
        aria-label={ar ? "القسم السابق (⌥↑)" : "Previous section (⌥↑)"}
        title={ar ? "القسم السابق (⌥↑)" : "Previous section (⌥↑)"}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={ar ? "كل الأقسام" : "All sections"}
        >
          <List className="h-3.5 w-3.5 shrink-0" />
          <span className="num shrink-0" data-tabular="true">
            {current + 1}/{sections.length}
          </span>
          <span className="truncate">{sectionTitle(sections[current], current + 1, lang)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-[60vh] w-64 overflow-y-auto">
          {sections.map((el, i) => (
            <DropdownMenuItem
              key={i}
              onSelect={() => requestAnimationFrame(() => goTo(el))}
              className={i === current ? "font-semibold text-foreground" : undefined}
            >
              <span className="num me-2 w-5 shrink-0 text-muted-foreground" data-tabular="true">{i + 1}</span>
              <span className="truncate">{sectionTitle(el, i + 1, lang)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={pill}
        onClick={() => step("next")}
        disabled={current >= sections.length - 1}
        aria-label={ar ? "القسم التالي (⌥↓)" : "Next section (⌥↓)"}
        title={ar ? "القسم التالي (⌥↓)" : "Next section (⌥↓)"}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </nav>
  );
}
