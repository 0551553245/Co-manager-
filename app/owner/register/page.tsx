import { RegisterForm } from "./RegisterForm";

export default function OwnerRegisterPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-display text-2xl">Create your Co Manager account</h1>
      <p className="mt-1 text-sm text-ink/70">
        14-day free trial, no card required.
      </p>
      {searchParams.error === "confirmation_failed" && (
        <p className="mt-4 rounded bg-red/16 p-3 text-sm text-red-ink">
          That confirmation link is invalid or expired. Please register again.
        </p>
      )}
      <div className="mt-8">
        <RegisterForm />
      </div>
    </main>
  );
}
