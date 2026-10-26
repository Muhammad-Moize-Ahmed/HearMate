import type { ButtonHTMLAttributes } from 'react';

import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'sunny';
type Size = 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[0_4px_0_var(--color-brand-800)] hover:bg-brand-700 active:translate-y-0.5 active:shadow-[0_2px_0_var(--color-brand-800)]',
  secondary: 'bg-white text-brand-700 ring-2 ring-brand-200 hover:bg-brand-50 hover:ring-brand-300',
  ghost: 'text-brand-700 hover:bg-brand-100',
  sunny:
    'bg-sun-300 text-ink shadow-[0_4px_0_#ca8a04] hover:bg-sun-200 active:translate-y-0.5 active:shadow-[0_2px_0_#ca8a04]',
};

// Every size is at least 48px tall: comfortable for small fingers.
const SIZES: Record<Size, string> = {
  md: 'min-h-12 px-5 text-base',
  lg: 'min-h-14 px-6 text-lg',
  xl: 'min-h-16 px-8 text-xl',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
