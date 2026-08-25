import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { signAttachment } from "@/lib/storage-actions";

/**
 * A photo thumbnail from a storage path.
 *
 * This is the one place that deliberately resolves a signed URL at RENDER time
 * rather than on click, because an <img> needs a src to show anything. That
 * makes a gallery cost one signature per visible photo — so the result is
 * cached under the path with a five-minute staleTime, comfortably inside the
 * ten-minute link life, and the query is keyed per path so remounting the
 * gallery does not re-sign what is already in hand.
 *
 * A path that will not sign renders as a placeholder rather than a broken image
 * icon: the file may be gone, or the viewer may simply not be allowed to see
 * it, and neither is worth a console error.
 */
export function AttachmentThumb({ storagePath, alt }: { storagePath: string; alt: string }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ["attachment-thumb", storagePath],
    queryFn: () => signAttachment(storagePath),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return <div className="aspect-[4/3] w-full animate-pulse bg-surface-2" aria-hidden="true" />;
  }
  if (!url) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-2" title={alt}>
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="aspect-[4/3] w-full object-cover"
    />
  );
}
