import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <title>Page not found · HearMate</title>
      <span className="text-7xl" aria-hidden="true">
        🙈
      </span>
      <h1 className="text-3xl font-black">Oops! This page wandered off.</h1>
      <Link
        to="/"
        className="inline-flex min-h-12 items-center rounded-2xl bg-brand-600 px-6 font-bold text-white hover:bg-brand-700"
      >
        Take me home
      </Link>
    </div>
  );
}
