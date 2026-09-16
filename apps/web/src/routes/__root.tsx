import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  ),
  notFoundComponent: () => <div className="signin"><div className="box"><h1>Page not found</h1><a href="/">Back to sign-in</a></div></div>,
});
