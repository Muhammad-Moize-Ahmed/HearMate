import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'online' | 'offline';

const statusLabel: Record<ApiStatus, string> = {
  checking: 'Checking API…',
  online: 'API online',
  offline: 'API unreachable',
};

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((res) => setApiStatus(res.ok ? 'online' : 'offline'))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setApiStatus('offline');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-slate-900">
      <h1 className="text-4xl font-bold">HearMate</h1>
      <p className="text-lg text-slate-600">Auditory training for children with APD</p>
      <p role="status" className="rounded-full bg-white px-4 py-1 text-sm shadow">
        {statusLabel[apiStatus]}
      </p>
    </main>
  );
}

export default App;
