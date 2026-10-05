import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { LoginPage, RegisterPage, RequireAuth } from '@/features/auth/AuthPages';
import { ApiKeysPage } from '@/features/keys/ApiKeysPage';
import { DashboardPage } from '@/features/links/DashboardPage';
import { LinkPage } from '@/features/links/LinkPage';

const secured = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: secured(<DashboardPage />) },
      { path: 'links/:id', element: secured(<LinkPage />) },
      { path: 'keys', element: secured(<ApiKeysPage />) },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
