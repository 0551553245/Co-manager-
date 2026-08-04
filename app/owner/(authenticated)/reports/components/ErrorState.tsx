export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-red/16 p-8 text-center">
      <p className="text-sm text-red-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-pill bg-red-ink px-3 py-1 text-xs text-cream transition-opacity duration-150 hover:opacity-90"
      >
        Retry
      </button>
    </div>
  );
}
