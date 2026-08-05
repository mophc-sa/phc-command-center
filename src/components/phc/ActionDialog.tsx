import { useEffect, useRef, useState, type ReactNode } from "react";
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

export type DialogField =
  | {
      key: string;
      type: "text" | "textarea" | "date";
      label: string;
      placeholder?: string;
      required?: boolean;
      defaultValue?: string;
    }
  | {
      key: string;
      type: "select";
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
      label: string;
      required?: boolean;
      // Folder within the attachments bucket, e.g. "boq" or "quotations".
      folder: string;
    }
  | {
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

export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submitLabel,
  destructive,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  fields: DialogField[];
  submitLabel: string;
  destructive?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
}) {
  const { t, dir } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extraOptions, setExtraOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [creating, setCreating] = useState<string | null>(null);

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
  useEffect(() => {
    if (open && !wasOpen.current) {
      const seed: Record<string, string> = {};
      for (const f of fieldsRef.current) seed[f.key] = "defaultValue" in f ? (f.defaultValue ?? "") : "";
      setValues(seed);
      setErrors({});
    }
    wasOpen.current = open;
  }, [open]);

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
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(values);
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
        <div className={cn("grid gap-4 overflow-y-auto py-2", isWide && "sm:grid-cols-2 max-h-[55vh] pe-1")}>
          {fields.map((f) => (
            <div key={f.key} className={cn("grid gap-1.5", isWide && (f.type === "textarea" || f.type === "file" || f.type === "file_or_url") && "sm:col-span-2")}>
              <Label htmlFor={f.key} className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
                        const { url } = await uploadAttachment(f.folder, file);
                        setValues((v) => ({ ...v, [f.key]: url ?? "" }));
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
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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
                          const { url } = await uploadAttachment(f.folder, file);
                          setValues((v) => ({ ...v, [f.key]: url ?? "" }));
                        } catch (err) {
                          toast.error(t("toast_error") + (err instanceof Error ? `: ${err.message}` : ""));
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </div>
                </div>
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
