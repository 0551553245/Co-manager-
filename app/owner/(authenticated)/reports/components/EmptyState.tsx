export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-cream p-8 text-center">
      <p className="text-sm text-ink/60">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 rounded-pill border px-3 py-1 text-xs text-ink/70 transition-colors duration-150 hover:bg-card"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
