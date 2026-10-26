import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Providers } from './app/Providers';
import { createQueryClient } from './app/queryClient';
import { routes } from './app/routes';

function App() {
  // Created once per mount (not per module), so each test starts with an empty cache.
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  return (
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}

export default App;
