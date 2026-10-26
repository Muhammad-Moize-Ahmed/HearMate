export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'sunny' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'xl';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[0_4px_0_var(--color-brand-800)] hover:bg-brand-700 active:translate-y-0.5 active:shadow-[0_2px_0_var(--color-brand-800)]',
  secondary: 'bg-white text-brand-700 ring-2 ring-brand-200 hover:bg-brand-50 hover:ring-brand-300',
  ghost: 'text-brand-700 hover:bg-brand-100',
  sunny:
    'bg-sun-300 text-ink shadow-[0_4px_0_#ca8a04] hover:bg-sun-200 active:translate-y-0.5 active:shadow-[0_2px_0_#ca8a04]',
  danger: 'bg-rose-700 text-white hover:bg-rose-800',
};

// Every size is at least 48px tall: comfortable for small fingers.
const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-12 px-5 text-base',
  lg: 'min-h-14 px-6 text-lg',
  xl: 'min-h-16 px-8 text-xl',
};

/** Classes for anything that looks like a button: `<Button>` and `<LinkButton>`. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}): string {
  return `inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? 'w-full' : ''}`;
}
