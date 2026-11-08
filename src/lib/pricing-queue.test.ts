import { describe, expect, it } from "bun:test";
import { compareQueue, isOverdue, localDateString, type QueueSortItem } from "@/lib/pricing-queue";

const it_ = (fileId: string, dueAt: string | null, days: number, value: number | null): QueueSortItem => ({ fileId, dueAt, days, value });
const order = (xs: QueueSortItem[]) => [...xs].sort(compareQueue).map((x) => x.fileId);

describe("compareQueue", () => {
  it("due date ascending, no due date last", () => {
    expect(order([it_("a", null, 9, 9), it_("b", "2026-11-09", 0, 0), it_("c", "2026-11-02", 0, 0)])).toEqual(["c", "b", "a"]);
  });
  it("then days waiting descending", () => {
    expect(order([it_("a", "2026-11-02", 1, 5), it_("b", "2026-11-02", 4, 1)])).toEqual(["b", "a"]);
  });
  it("then value descending, null last", () => {
    expect(order([it_("a", null, 2, null), it_("b", null, 2, 10), it_("c", null, 2, 50)])).toEqual(["c", "b", "a"]);
  });
  it("then file id for a stable order", () => {
    expect(order([it_("b", null, 2, 10), it_("a", null, 2, 10)])).toEqual(["a", "b"]);
  });
});

describe("local date", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(localDateString(new Date(2026, 10, 4, 0, 30))).toBe("2026-11-04");
    expect(localDateString(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
  });
  it("overdue only once the day has passed", () => {
    expect(isOverdue("2026-11-03", "2026-11-04")).toBe(true);
    expect(isOverdue("2026-11-04", "2026-11-04")).toBe(false);
    expect(isOverdue(null, "2026-11-04")).toBe(false);
  });
});
