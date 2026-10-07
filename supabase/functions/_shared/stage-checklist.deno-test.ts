// =============================================================================
// Stage checklist: the same rules for the deal page and the daily assistant.
// =============================================================================

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CHECKLIST_ITEM_KEYS, EMPTY_FACTS, evaluateChecklist, STAGE_CHECKLIST } from "./stage-checklist.ts";

Deno.test("rfq_received: auto items follow the data, manual items follow the rep", () => {
  const r = evaluateChecklist("rfq_received", {
    ...EMPTY_FACTS, buyer_type: "main_contractor", roles: ["decision_maker", "technical"], manual: { site_visit: true },
  });
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assertEquals(by.buyer_type.done, true);
  assertEquals(by.decision_maker.done, true);
  assertEquals(by.procurement.done, false);
  assertEquals(by.site_visit.done, true);
  assertEquals(by.tender_file.done, false);
  assertEquals(by.buyer_type.kind, "auto");
  assertEquals(by.site_visit.kind, "manual");
});

Deno.test("jih: priced BOQ, quotation and an approved account", () => {
  const none = evaluateChecklist("jih", EMPTY_FACTS).filter((x) => x.done).map((x) => x.key);
  assertEquals(none, []);
  const all = evaluateChecklist("jih", { ...EMPTY_FACTS, boq_item_count: 3, quotation_count: 1, prequalification_status: "approved", manual: { why_phc: true } });
  assertEquals(all.every((x) => x.done), true);
});

Deno.test("lost needs a real loss reason; won and on_hold", () => {
  assertEquals(evaluateChecklist("lost", { ...EMPTY_FACTS, loss_reason: "  " })[0].done, false);
  assertEquals(evaluateChecklist("lost", { ...EMPTY_FACTS, loss_reason: "price" })[0].done, true);
  assertEquals(evaluateChecklist("won", EMPTY_FACTS).length, 2);
  assertEquals(evaluateChecklist("on_hold", EMPTY_FACTS), []);
  assertEquals(evaluateChecklist(null, EMPTY_FACTS), []);
  assertEquals(evaluateChecklist("not_a_stage", EMPTY_FACTS), []);
});

Deno.test("every stage item is a known key, and keys are unique", () => {
  for (const items of Object.values(STAGE_CHECKLIST)) {
    for (const it of items) assertEquals(CHECKLIST_ITEM_KEYS.includes(it.key), true, it.key);
  }
  assertEquals(new Set(CHECKLIST_ITEM_KEYS).size, CHECKLIST_ITEM_KEYS.length);
});
