import type { ButtonHTMLAttributes, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';

import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';
import { Spinner } from './Spinner';

type Look = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Look & { loading?: boolean; ref?: Ref<HTMLButtonElement> };

export function Button({
  variant,
  size,
  fullWidth,
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
      className={`${buttonClasses({ variant, size, fullWidth })} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A link that looks like a button (navigation should be a link, not a button). */
export function LinkButton({
  variant,
  size,
  fullWidth,
  className = '',
  ...props
}: LinkProps & Look) {
  return (
    <Link className={`${buttonClasses({ variant, size, fullWidth })} ${className}`} {...props} />
  );
}
