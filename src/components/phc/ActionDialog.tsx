import { useEffect, useState, type ReactNode } from "react";
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
    }
  | {
      key: string;
      type: "file";
      label: string;
      required?: boolean;
      // Folder within the attachments bucket, e.g. "boq" or "quotations".
      folder: string;
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

  useEffect(() => {
    if (open) {
      const seed: Record<string, string> = {};
      for (const f of fields) seed[f.key] = "defaultValue" in f ? (f.defaultValue ?? "") : "";
      setValues(seed);
      setErrors({});
    }
  }, [open, fields]);

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
      if (f.required && !values[f.key]) newErrors[f.key] = t("dialog_field_required");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1.5">
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
              ) : f.type === "select" ? (
                <Select
                  value={values[f.key] ? values[f.key] : "__none__"}
                  onValueChange={(v) => {
                    setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v }));
                    clearFieldError(f.key);
                  }}
                >
                  <SelectTrigger
                    id={f.key}
                    aria-required={f.required ?? undefined}
                    aria-invalid={errors[f.key] ? true : undefined}
                    aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                  >
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
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
