import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ineligibleReasons } from "../sales-os-api/handlers/historical-promotion.ts";
Deno.test("all-years activation admits older complete active records without relaxing data gates", () => {
  const row = {date_submitted:"2025-10-01",status:"SUBMITTED",owner_user_id:"owner",company_matched:true,amount:100,route:"jih",collision_class:"NO_COLLISION",promotion_status:"not_promoted"};
  const flags = {placeholder:false,unparsed:false,hasCode:true};
  const statuses = new Set(["SUBMITTED"]);
  assertEquals(ineligibleReasons(row,statuses,flags), ["not_2026"]);
  assertEquals(ineligibleReasons(row,statuses,flags,"all"), []);
  assertEquals(ineligibleReasons({...row,status:"LOST"},statuses,flags,"all"), ["status_not_active"]);
  assertEquals(ineligibleReasons({...row,amount:null},statuses,flags,"all"), ["no_amount"]);
  assertEquals(ineligibleReasons({...row,promotion_status:"promoted"},statuses,flags,"all"), ["already_promoted"]);
  assertEquals(ineligibleReasons(row,statuses,{...flags,placeholder:true},"all"), ["code_placeholder"]);
});
