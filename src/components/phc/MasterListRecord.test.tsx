import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MasterListRecord } from "./MasterListRecord";

describe("MasterListRecord", () => {
  it("renders nothing without a master-list row", () => {
    expect(renderToStaticMarkup(<MasterListRecord extraData={{}} ar={false} />)).toBe("");
  });
  it("shows the file's columns, raw text when a date was not a date, and only http links", () => {
    const html = renderToStaticMarkup(
      <MasterListRecord
        ar={false}
        extraData={{
          master_list: {
            code: "FA26090",
            amount_raw: "RATES ONLY",
            raw_received: "No record",
            photo_link: "javascript:alert(1)",
            update_log: "4-May: called",
          },
        }}
      />,
    );
    expect(html).toContain("FA26090");
    expect(html).toContain("RATES ONLY");
    expect(html).toContain("No record");
    expect(html).toContain("4-May: called");
    expect(html).not.toContain(`href="javascript:`);
  });
  it("shows the November 2026 columns, newest first, beside the September row", () => {
    const html = renderToStaticMarkup(
      <MasterListRecord
        ar={false}
        extraData={{
          master_list: { code: "FA25106" },
          master_list_2026_11: {
            code: "FA25106",
            codes: ["FA25106", "OM"],
            priority: "NEED FOLLOW-UP",
            po_status: "RECEIVED PO/SCA",
            client: "IMC",
          },
        }}
      />,
    );
    expect(html).toContain("November 2026");
    expect(html).toContain("NEED FOLLOW-UP");
    expect(html).toContain("RECEIVED PO/SCA");
    expect(html).toContain("FA25106 · OM");
    expect(html.indexOf("November 2026")).toBeLessThan(html.indexOf("September 2026"));
  });
});
