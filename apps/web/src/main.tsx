import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import InstallPrompt from './components/InstallPrompt';

const qc = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <App />
          <InstallPrompt />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
