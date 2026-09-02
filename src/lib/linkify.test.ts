import { describe, expect, it } from "bun:test";
import { hasLink, linkify } from "@/lib/linkify";

const links = (s: string) => linkify(s).filter((x) => x.kind === "link");
const text = (s: string) => linkify(s).map((x) => x.text).join("");

describe("what becomes a link", () => {
  it("turns an http(s) address into one", () => {
    expect(links("see https://phc-sa.com/boq")).toEqual([
      { kind: "link", text: "https://phc-sa.com/boq", href: "https://phc-sa.com/boq" },
    ]);
  });

  it("never turns javascript: or data: into one", () => {
    // A detail field is user-supplied text, and a link is the one element on
    // the page that runs something on click. These stay as characters.
    for (const s of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox"]) {
      expect(links(s)).toEqual([]);
      expect(text(s)).toBe(s);
    }
  });

  it("does not guess at bare domains", () => {
    // "see section 3.2" and "phc-sa.com" are indistinguishable to a pattern
    // loose enough to catch the second, and a wrong link is worse than none.
    expect(links("see section 3.2 and phc-sa.com")).toEqual([]);
  });
});

describe("where a link ends", () => {
  it("leaves the full stop with the sentence", () => {
    const out = linkify("The BOQ is at https://phc-sa.com/boq.");
    expect(out.filter((x) => x.kind === "link")[0].href).toBe("https://phc-sa.com/boq");
    expect(text("The BOQ is at https://phc-sa.com/boq.")).toBe("The BOQ is at https://phc-sa.com/boq.");
  });

  it("leaves a closing bracket out of the address", () => {
    expect(links("(https://phc-sa.com/a)")[0].href).toBe("https://phc-sa.com/a");
  });

  it("keeps a query string, which is part of the address", () => {
    const u = "https://phc-sa.com/s?q=belleview&tier=A";
    expect(links(`open ${u}`)[0].href).toBe(u);
  });
});

describe("nothing is lost", () => {
  it("reassembles to exactly the input", () => {
    // The segments are rendered in order, so any character dropped here is a
    // character missing from the page.
    for (const s of [
      "",
      "no links here",
      "https://a.example",
      "before https://a.example after",
      "two https://a.example and https://b.example ends",
      "trailing https://a.example.",
    ]) {
      expect(text(s)).toBe(s);
    }
  });
});

describe("hasLink", () => {
  it("answers the same question twice in a row", () => {
    // The regex is /g, so a shared lastIndex would make the second call lie.
    expect(hasLink("go to https://phc-sa.com")).toBe(true);
    expect(hasLink("go to https://phc-sa.com")).toBe(true);
    expect(hasLink("no link")).toBe(false);
  });
});
