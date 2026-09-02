import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { composePhone, isUsablePhone, localPart, SAUDI_PREFIX } from "@/lib/phone-entry";
import {
  draftAgeMinutes,
  draftKey as makeDraftKey,
  draftPayload,
  hasContent,
  readDraft,
} from "@/lib/form-draft";
import {
  validateDateBounds,
  dateBoundsErrorKey,
  maxAllowedDate,
  MIN_DATE,
} from "@/lib/date-bounds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { uploadAttachment } from "@/lib/storage-actions";
import { cn } from "@/lib/utils";

/**
 * A field that only appears once another answer calls for it.
 *
 * "Other" lists need somewhere to write what "other" was, and a free-text box
 * sitting there permanently under a closed list is one more thing to read past
 * on a twenty-field form.
 */
export type DialogFieldCondition = { field: string; equals: string };

export type DialogField =
  | {
      key: string;
      // "phone" is a text box with a +966 chip in front of it. See
      // phone-entry.ts -- the prefix is a default, not a cage.
      type: "text" | "textarea" | "date" | "checkbox" | "phone";
      showWhen?: DialogFieldCondition;
      label: string;
      placeholder?: string;
      required?: boolean;
      defaultValue?: string;
    }
  | {
      key: string;
      type: "select";
      showWhen?: DialogFieldCondition;
      label: string;
      required?: boolean;
      defaultValue?: string;
      options: { value: string; label: string }[];
      onCreateNew?: () => Promise<{ value: string; label: string } | null>;
      createLabel?: string;
    }
  | {
      key: string;
      type: "file";
      showWhen?: DialogFieldCondition;
      label: string;
      required?: boolean;
      // Folder within the attachments bucket, e.g. "boq" or "quotations".
      folder: string;
    }
  | {
      showWhen?: DialogFieldCondition;
      // Accepts either a pasted link or an uploaded file, into the same value.
      //
      // Spec §24 lists "Email reference" among the attachments an RFQ carries,
      // and the Source dropdown leads with "Email" — so the common case is a
      // link to a message, not a file on disk. The intake form's evidence field
      // was declared `type: "file"` while being labelled "evidence URL", so a
      // salesperson whose RFQ arrives by email had nothing to paste it into
      // (field report 2026-08-05).
      key: string;
      type: "file_or_url";
      label: string;
      required?: boolean;
      folder: string;
      placeholder?: string;
      defaultValue?: string;
    };

/** "3 minutes ago" / "2 days ago" -- the age matters more than the timestamp. */
function draftAgeLabel(minutes: number, t: (k: never) => string): string {
  if (minutes < 1) return t("draft_age_now" as never);
  if (minutes < 60) return `${minutes} ${t("draft_age_minutes" as never)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("draft_age_hours" as never)}`;
  return `${Math.floor(hours / 24)} ${t("draft_age_days" as never)}`;
}

export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submitLabel,
  destructive,
  onSubmit,
  draftId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  fields: DialogField[];
  submitLabel: string;
  destructive?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  /**
   * Give a form an id and it keeps what was typed into it.
   *
   * Reported 2026-09-02: leaving a half-filled entry form loses everything. The
   * draft is per person (the key carries the user id), announced rather than
   * restored silently, and discardable in one click. See form-draft.ts.
   */
  draftId?: string;
}) {
  const { t, dir } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extraOptions, setExtraOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const { user } = useAuth();
  const storageKey = draftId ? makeDraftKey(user?.id, draftId) : null;
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  // `fields` is rebuilt inline by every caller (e.g. `fields={newIntakeFields(...)}`),
  // so its identity changes on every parent render. Keeping it in a ref lets the
  // seeding effect read the current fields without depending on that identity.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // Seed ONLY on the false -> true edge of `open`.
  //
  // This used to be `useEffect(..., [open, fields])`, which reset every input to
  // its default on any parent re-render while the dialog was open. React Query
  // refetches on window focus by default, so the sequence a real user performs —
  // open the form, switch to email to copy a link, come back — refetched, re-rendered,
  // handed the dialog a new `fields` array, and wiped everything they had typed.
  // Reported from the field 2026-08-05; it affected every dialog in the app, and
  // made spec §45-1 ("create a new RFQ in under two minutes") unachievable.
  const wasOpen = useRef(false);
  const defaultsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (open && !wasOpen.current) {
      const seed: Record<string, string> = {};
      for (const f of fieldsRef.current) seed[f.key] = "defaultValue" in f ? (f.defaultValue ?? "") : "";
      defaultsRef.current = { ...seed };

      // A draft is layered ON TOP of the defaults, never instead of them: a
      // field the user never reached still gets its seeded value.
      let restored: number | null = null;
      if (storageKey) {
        try {
          const d = readDraft(localStorage.getItem(storageKey), Date.now());
          if (d) {
            Object.assign(seed, d.values);
            restored = d.savedAt;
          }
        } catch {
          // Private windows and blocked site data throw on access. A form that
          // cannot open because of a draft is worse than one that lost it.
        }
      }
      setValues(seed);
      setRestoredAt(restored);
      setErrors({});
    }
    wasOpen.current = open;
  }, [open, storageKey]);

  // Written on every change while the dialog is open. Only what the user
  // actually typed -- see draftPayload for why defaults are excluded.
  useEffect(() => {
    if (!open || !storageKey) return;
    const payload = draftPayload(values, defaultsRef.current);
    try {
      if (hasContent(payload)) {
        localStorage.setItem(storageKey, JSON.stringify({ values: payload, savedAt: Date.now() }));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // Storage full, or disabled. Losing the draft is the old behaviour, not
      // a new failure, and it must not take the form down with it.
    }
  }, [values, open, storageKey]);

  const clearDraft = () => {
    if (!storageKey) return;
    try { localStorage.removeItem(storageKey); } catch { /* see above */ }
  };

  const discardDraft = () => {
    clearDraft();
    setValues({ ...defaultsRef.current });
    setRestoredAt(null);
  };

  /**
   * Whether a field is on screen right now.
   *
   * Used by BOTH the renderer and the validator, deliberately: a hidden
   * required field that blocks submit is a form refusing to save for a reason
   * nobody can see.
   */
  const isVisible = (f: DialogField) =>
    !f.showWhen || values[f.showWhen.field] === f.showWhen.equals;

  function clearFieldError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit() {
    // Collect all validation errors before bailing so every required field is marked at once.
    const newErrors: Record<string, string> = {};
    for (const f of fields) {
      if (!isVisible(f)) continue;
      if (f.required && !values[f.key]) {
        newErrors[f.key] = t("dialog_field_required");
        continue;
      }
      // Date bounds: the browser's own date picker happily emits six-digit
      // years, which then sit in the DB excluded from every deadline query.
      // See src/lib/date-bounds.ts for the live case this guards against.
      if (f.type === "date") {
        const res = validateDateBounds(values[f.key]);
        if (!res.ok) newErrors[f.key] = t(dateBoundsErrorKey(res.reason));
      }
      // A phone that was typed must be dialable. An empty one is the required
      // check's business, not this one's -- two errors on one field would be
      // the form arguing with itself.
      if (f.type === "phone" && values[f.key] && !isUsablePhone(values[f.key])) {
        newErrors[f.key] = t("dialog_phone_invalid");
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(values);
      // Only here. A failed submit keeps the draft, which is the moment it is
      // most needed.
      clearDraft();
      setRestoredAt(null);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  // Long forms (e.g. the intake form's ~19 fields) get a wider dialog and a
  // 2-column grid so the dialog scrolls a handful of rows deep instead of a
  // single towering column; short forms (most callers — a single "reason"
  // textarea, 2-3 fields) are untouched.
  const isWide = fields.length > 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className={cn("flex flex-col", isWide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            // Radix requires DialogContent to have an aria-describedby target;
            // most callers here don't pass a visible description, so this
            // sr-only fallback keeps every dialog accessible without adding
            // visible copy (found via /qa: every ActionDialog without a
            // description prop was logging a Radix a11y warning on open).
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>

        {/* Never a silent restore. Repopulating a form without saying so is a
            way to file last week's answers under today's date. */}
        {restoredAt !== null ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber/40 bg-amber/10 px-3 py-2">
            <span className="text-xs text-foreground">
              {t("draft_restored")}
              {" · "}
              <span className="text-muted-foreground">
                {draftAgeLabel(draftAgeMinutes(restoredAt, Date.now()), t)}
              </span>
            </span>
            <button
              type="button"
              onClick={discardDraft}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("draft_discard")}
            </button>
          </div>
        ) : null}

        <div className={cn("grid gap-4 overflow-y-auto py-2", isWide && "sm:grid-cols-2 max-h-[55vh] pe-1")}>
          {fields.filter(isVisible).map((f) => (
            <div key={f.key} className={cn("grid gap-1.5", isWide && (f.type === "textarea" || f.type === "file" || f.type === "file_or_url") && "sm:col-span-2")}>
              <Label htmlFor={f.key} className="text-xs tracking-[0.02em] text-muted-foreground">
                {f.label}
                {f.required ? <span aria-hidden="true"> *</span> : ""}
              </Label>
              {f.type === "textarea" ? (
                <Textarea
                  id={f.key}
                  value={values[f.key] ?? ""}
                  placeholder={"placeholder" in f ? f.placeholder : undefined}
                  aria-required={f.required ?? undefined}
                  aria-invalid={errors[f.key] ? true : undefined}
                  aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.key]: e.target.value }));
                    clearFieldError(f.key);
                  }}
                  rows={4}
                />
              ) : f.type === "file" ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={f.key}
                    type="file"
                    disabled={uploading}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      clearFieldError(f.key);
                      try {
                        // Persist the PATH, not a signed URL. A signed URL is a temporary
                        // key that expires and leaves the row pointing at nothing.
                        const { path } = await uploadAttachment(f.folder, file);
                        setValues((v) => ({ ...v, [f.key]: path }));
                      } catch (err) {
                        toast.error(t("toast_error") + (err instanceof Error ? `: ${err.message}` : ""));
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  {values[f.key] ? <span className="text-xs text-won" aria-hidden="true">✓</span> : null}
                </div>
              ) : f.type === "file_or_url" ? (
                <div className="grid gap-1.5">
                  <Input
                    id={f.key}
                    type="text"
                    inputMode="url"
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder ?? t("dialog_paste_link")}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [f.key]: e.target.value }));
                      clearFieldError(f.key);
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-2xs tracking-[0.02em] text-muted-foreground">
                      {t("dialog_or_upload")}
                    </span>
                    <Input
                      type="file"
                      className="h-8 flex-1 text-xs"
                      disabled={uploading}
                      aria-label={`${f.label} — ${t("dialog_or_upload")}`}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        clearFieldError(f.key);
                        try {
                          // Persist the PATH, not a signed URL. A signed URL
                          // is a temporary key that expires and leaves the row
                          // pointing at nothing; the path is the address.
                          const { path } = await uploadAttachment(f.folder, file);
                          setValues((v) => ({ ...v, [f.key]: path }));
                        } catch (err) {
                          toast.error(t("toast_error") + (err instanceof Error ? `: ${err.message}` : ""));
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </div>
                </div>
              ) : f.type === "checkbox" ? (
                // Phase 2 intake needs a few plain yes/no facts ("did a BOQ
                // arrive?"). Modelled as a real checkbox rather than a
                // two-option select so it reads as the boolean it is.
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-foreground"
                    // Stored as "true"/"" so the shared values map stays
                    // Record<string,string> — widening it would touch every
                    // dialog in the app for one field type.
                    checked={values[f.key] === "true"}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked ? "true" : "" }))}
                  />
                  <span className="text-muted-foreground">{f.label}</span>
                </label>
              ) : f.type === "select" ? (
                <Select
                  value={values[f.key] ? values[f.key] : "__none__"}
                  onValueChange={async (v) => {
                    if (v === "__create__") {
                      if (!f.onCreateNew) return;
                      setCreating(f.key);
                      try {
                        const created = await f.onCreateNew();
                        if (created) {
                          setExtraOptions((prev) => ({ ...prev, [f.key]: [...(prev[f.key] ?? []), created] }));
                          setValues((prev) => ({ ...prev, [f.key]: created.value }));
                          clearFieldError(f.key);
                        }
                      } finally {
                        setCreating(null);
                      }
                      return;
                    }
                    setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v }));
                    clearFieldError(f.key);
                  }}
                >
                  <SelectTrigger
                    id={f.key}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                    disabled={creating === f.key}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.onCreateNew ? (
                      <SelectItem value="__create__">{f.createLabel ?? t("dialog_create_new")}</SelectItem>
                    ) : null}
                    {[...f.options, ...(extraOptions[f.key] ?? [])].map((o) => (
                      <SelectItem key={o.value === "" ? "__none__" : o.value} value={o.value === "" ? "__none__" : o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "phone" ? (
                // The chip is a label, not a value: what gets stored always
                // carries its own country code, so a number is never ambiguous
                // once it leaves this box.
                <div className={cn(
                  "flex items-center gap-2 rounded-md border bg-transparent ps-2",
                  errors[f.key] ? "border-destructive" : "border-input",
                )}>
                  {localPart(values[f.key] ?? "").showsPrefix ? (
                    <span className="num shrink-0 select-none text-sm text-muted-foreground" data-tabular="true">
                      {SAUDI_PREFIX}
                    </span>
                  ) : null}
                  <Input
                    id={f.key}
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    className="num border-0 px-0 shadow-none focus-visible:ring-0"
                    data-tabular="true"
                    value={localPart(values[f.key] ?? "").text}
                    placeholder={"placeholder" in f ? f.placeholder : "5X XXX XXXX"}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [f.key]: composePhone(e.target.value) }));
                      clearFieldError(f.key);
                    }}
                  />
                </div>
              ) : (
                <Input
                  id={f.key}
                  type={f.type === "date" ? "date" : "text"}
                  // Native bounds stop the spinner/keyboard from reaching an
                  // absurd year at all; handleSubmit still re-checks, since a
                  // pasted value can bypass these.
                  min={f.type === "date" ? MIN_DATE : undefined}
                  max={f.type === "date" ? maxAllowedDate() : undefined}
                  value={values[f.key] ?? ""}
                  placeholder={"placeholder" in f ? f.placeholder : undefined}
                  aria-required={f.required ?? undefined}
                  aria-invalid={errors[f.key] ? true : undefined}
                  aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.key]: e.target.value }));
                    clearFieldError(f.key);
                  }}
                />
              )}
              {errors[f.key] ? (
                <p id={`${f.key}-err`} role="alert" className="text-xs text-destructive">
                  {errors[f.key]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleSubmit}
            disabled={busy || uploading}
          >
            {busy || uploading ? t("loading") : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
