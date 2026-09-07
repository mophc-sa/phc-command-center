# All-years sales activation and production UAT repairs

User scope: all historical data, replacing the earlier 2026-only request.

Production inventory: 679 archive rows, 45 already promoted. A pinned set of 80 additional active rows has complete baseline fields and active mapped owners (OM, FA, AB/NI mappings); total SAR 150,723,240 excluding VAT. The manifest is checked against current identities and total before writes. Closed outcomes, missing fields and unresolved collisions do not become invented open opportunities. SQL remains the authority for promotion.

Frontend activation now uses the all-years manifest. The original 2026 manifest and default batch scope remain available for compatibility; individual preflight supports older records. Activation still requires sales_manager, bd_manager or general_manager. The current operator account has system_admin + salesperson and cannot activate commercially. No roles or credentials were changed. A leadership session is requested; no activation writes from this change have occurred yet.

UI repairs: show more archive rows, filter undecided statuses, consistent quality totals, accurate live-CRM banner, error retry, hide management date-range controls on the independently filtered archive, and formula-safe CSV text exports.

Import repairs: visible duplicate decisions (staging matches cannot target CRM updates), AI review button respects the actual commercial capability, detailed AI errors, persisted failed-commit summaries and errors after reload. Duplicate refresh uses a service-only atomic RPC: replacement rather than append, preserving matching decisions, rejecting foreign rows and finalized batches, clearing stale row flags and counts. Reapply this migration before deploying import-pipeline.

Release surfaces: Worker UI; sales-os-api (all-years preflight); import-pipeline (atomic duplicate refresh); migration 20260928140000. Deploy through the normal main checks, canary and readiness gates. Full archive inventory and row-specific blockers are stored outside Git in the user deliverable.
