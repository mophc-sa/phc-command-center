# Operational UX improvements

This change makes dashboard links match the records they describe, preserves form input when saves fail, and makes operational lists easier to scan. It changes application code; it does not deploy production or change business records.

## Implemented

- KPI drilldowns and repair links have separate destinations. Stage groups, missing-value and missing-probability filters are honored. Won/lost date filters use outcome dates.
- The shared action dialog keeps the form open on submission failure. Save handlers propagate errors to it. New intake uses progressive sections and focuses validation failures.
- Workspace urgency appears before summary metrics. Opportunity and account lists use semantic tables, readable names, explicit missing values, and personal browser-local saved opportunity views.
- Work queue groups related actions without discarding tasks. Intake deep links load the selected item directly, including items outside the default list limit.
- Primary collection failures in the updated lists show retry states. Calendar adds an agenda view. Notifications have more readable subjects and controls.
- Supporting pages reduce empty media areas and technical metadata prominence. Navigation labels, touch targets, focus visibility and reduced-motion behavior are improved.

## Validation

`bun run verify` covers type checking, lint, the unit suite and production build. The suite includes synthetic regression cases for drilldown destinations, stage groups, missing data and outcome dates. Existing lint warnings and bundle-size advisories remain.

The reconstructed baseline tree exactly matches upstream main at `f155e60516dcbd6e5855d251f4d35d3c4d61cf9f`. No production values, private record identifiers or customer documents are introduced by this change.

## Review and release limits

Browser security policy blocked local visual inspection. Automated checks do not establish WCAG conformance or prove mobile layout quality. Before release, review the approved preview in Arabic/RTL and English at desktop and mobile widths; exercise keyboard focus, failed saves, network errors and supported roles. Follow the repository's canary and protected production release procedure.

## Follow-up implementation

- Validate the revised information architecture with actual user tasks and role-based usability testing.
- Unified intake review and record actions in one expandable table. Failed information requests and rejection saves retain input.
- Added permission-scoped filter links for sharing and use on another device. Personal saved views remain browser-local; server synchronization is a separate feature.
- Added owner and creation-cohort date filters to reports, explicit AI scope labels, metric definitions and accessible chart data tables.
- Added measured 4.5:1 contrast regression checks for core body-text semantic colors across three surfaces, and mobile English/Arabic failed-save interaction tests to the isolated role suite. Calendar warns about incomplete sources.

User research and a full assistive-technology audit remain validation activities; automated tests are not a WCAG certification. Deployment follows passing CI, isolated readiness, canary and production readiness gates.
