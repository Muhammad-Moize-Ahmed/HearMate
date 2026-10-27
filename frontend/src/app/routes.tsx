import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';

import { PublicOnly, RequireRole } from '../auth/guards';
import { FullPageSpinner } from '../components/ui/Spinner';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from '../features/landing/NotFoundPage';
import { AuthLayout } from './layouts/AuthLayout';
import { ChildLayout } from './layouts/ChildLayout';
import { RoleLayout } from './layouts/RoleLayout';

/**
 * A page loaded on first visit, in its own chunk: the first download carries only the shell
 * (router, auth, layouts, landing page) and each area fetches its own code (and libraries, such
 * as the chart library) when it is opened.
 */
function page<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  return async () => ({ Component: pick(await load()) });
}

/** Shown while the first page's code loads, before anything else is on screen. */
const hydrateFallbackElement = <FullPageSpinner />;

/**
 * Every screen. Each role's area sits behind `RequireRole`; the sign-in screens sit behind
 * `PublicOnly`, which sends a signed-in user on to their own area.
 */
export const routes: RouteObject[] = [
  {
    element: <AuthLayout />,
    hydrateFallbackElement,
    children: [
      { index: true, element: <LandingPage /> },
      {
        element: <PublicOnly />,
        children: [
          {
            path: 'login',
            lazy: page(
              () => import('../features/auth/LoginPage'),
              (m) => m.LoginPage,
            ),
          },
          {
            path: 'signup',
            lazy: page(
              () => import('../features/auth/SignupPage'),
              (m) => m.SignupPage,
            ),
          },
          {
            path: 'verify-email',
            lazy: page(
              () => import('../features/auth/VerifyEmailPage'),
              (m) => m.VerifyEmailPage,
            ),
          },
          {
            path: 'forgot-password',
            lazy: page(
              () => import('../features/auth/ForgotPasswordPage'),
              (m) => m.ForgotPasswordPage,
            ),
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <RequireRole kinds={['parent']} />,
    hydrateFallbackElement,
    children: [
      {
        path: 'parent',
        element: <RoleLayout roleLabel="Parent" badgeClass="bg-sun-200" home="/parent" />,
        children: [
          {
            index: true,
            lazy: page(
              () => import('../features/children/ParentDashboard'),
              (m) => m.ParentDashboard,
            ),
          },
          {
            path: 'children/new',
            lazy: page(
              () => import('../features/children/ChildFormPages'),
              (m) => m.NewChildPage,
            ),
          },
          {
            path: 'children/:childId',
            lazy: page(
              () => import('../features/children/ChildPage'),
              (m) => m.ChildPage,
            ),
          },
          {
            path: 'children/:childId/edit',
            lazy: page(
              () => import('../features/children/ChildFormPages'),
              (m) => m.EditChildPage,
            ),
          },
          {
            path: 'children/:childId/progress',
            lazy: page(
              () => import('../features/progress/ProgressPage'),
              (m) => m.ProgressPage,
            ),
          },
          {
            path: 'children/:childId/report',
            lazy: page(
              () => import('../features/progress/ReportPage'),
              (m) => m.ReportPage,
            ),
          },
        ],
      },
    ],
  },
  {
    element: <RequireRole kinds={['therapist']} />,
    hydrateFallbackElement,
    children: [
      {
        path: 'therapist',
        element: <RoleLayout roleLabel="Therapist" badgeClass="bg-mint-200" home="/therapist" />,
        children: [
          {
            index: true,
            lazy: page(
              () => import('../features/therapist/TherapistDashboard'),
              (m) => m.TherapistDashboard,
            ),
          },
          {
            // Only children with an active link to this therapist; see LinkedChildGate.
            path: 'children/:childId',
            lazy: page(
              () => import('../features/therapist/LinkedChildGate'),
              (m) => m.LinkedChildGate,
            ),
            children: [
              {
                index: true,
                lazy: page(
                  () => import('../features/therapist/TherapistChildPage'),
                  (m) => m.TherapistChildPage,
                ),
              },
              {
                path: 'progress',
                lazy: page(
                  () => import('../features/progress/ProgressPage'),
                  (m) => m.ProgressPage,
                ),
              },
              {
                path: 'report',
                lazy: page(
                  () => import('../features/progress/ReportPage'),
                  (m) => m.ReportPage,
                ),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    element: <RequireRole kinds={['admin']} />,
    hydrateFallbackElement,
    children: [
      {
        path: 'admin',
        element: <RoleLayout roleLabel="Admin" badgeClass="bg-slate-200" home="/admin" />,
        children: [
          {
            index: true,
            lazy: page(
              () => import('../features/admin/AdminDashboard'),
              (m) => m.AdminDashboard,
            ),
          },
          {
            path: 'users',
            lazy: page(
              () => import('../features/admin/AdminUsersPage'),
              (m) => m.AdminUsersPage,
            ),
          },
        ],
      },
    ],
  },
  {
    element: <RequireRole kinds={['child']} />,
    hydrateFallbackElement,
    children: [
      {
        path: 'play',
        element: <ChildLayout />,
        children: [
          {
            index: true,
            lazy: page(
              () => import('../features/play/ChildHome'),
              (m) => m.ChildHome,
            ),
          },
          {
            path: 'games/:slug',
            lazy: page(
              () => import('../features/play/GamePlayerPage'),
              (m) => m.GamePlayerPage,
            ),
          },
          {
            path: 'progress',
            lazy: page(
              () => import('../features/progress/MyProgressPage'),
              (m) => m.MyProgressPage,
            ),
          },
        ],
      },
    ],
  },
];
