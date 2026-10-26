import type { RouteObject } from 'react-router';

import { PublicOnly, RequireRole } from '../auth/guards';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
import { EditChildPage, NewChildPage } from '../features/children/ChildFormPages';
import { ChildPage } from '../features/children/ChildPage';
import { ParentDashboard } from '../features/children/ParentDashboard';
import { AdminHome, ChildHome, TherapistHome } from '../features/home/HomePages';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from '../features/landing/NotFoundPage';
import { AuthLayout } from './layouts/AuthLayout';
import { ChildLayout } from './layouts/ChildLayout';
import { RoleLayout } from './layouts/RoleLayout';

/**
 * Every screen. Each role's area sits behind `RequireRole`; the sign-in screens sit behind
 * `PublicOnly`, which sends a signed-in user on to their own area.
 */
export const routes: RouteObject[] = [
  {
    element: <AuthLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      {
        element: <PublicOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignupPage /> },
          { path: 'verify-email', element: <VerifyEmailPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <RequireRole kinds={['parent']} />,
    children: [
      {
        path: 'parent',
        element: <RoleLayout roleLabel="Parent" badgeClass="bg-sun-200" home="/parent" />,
        children: [
          { index: true, element: <ParentDashboard /> },
          { path: 'children/new', element: <NewChildPage /> },
          { path: 'children/:childId', element: <ChildPage /> },
          { path: 'children/:childId/edit', element: <EditChildPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireRole kinds={['therapist']} />,
    children: [
      {
        path: 'therapist',
        element: <RoleLayout roleLabel="Therapist" badgeClass="bg-mint-200" home="/therapist" />,
        children: [{ index: true, element: <TherapistHome /> }],
      },
    ],
  },
  {
    element: <RequireRole kinds={['admin']} />,
    children: [
      {
        path: 'admin',
        element: <RoleLayout roleLabel="Admin" badgeClass="bg-slate-200" home="/admin" />,
        children: [{ index: true, element: <AdminHome /> }],
      },
    ],
  },
  {
    element: <RequireRole kinds={['child']} />,
    children: [
      {
        path: 'play',
        element: <ChildLayout />,
        children: [{ index: true, element: <ChildHome /> }],
      },
    ],
  },
];
