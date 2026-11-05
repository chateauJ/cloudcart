import { InputHTMLAttributes } from "react";

// Label + input pair shared by the login, sign-up and confirmation forms
export default function AuthField({
  label,
  id,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...input}
        className="w-full rounded-md border border-foreground/15 px-3 py-2 text-sm"
      />
      {hint && <p className="mt-1 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}
