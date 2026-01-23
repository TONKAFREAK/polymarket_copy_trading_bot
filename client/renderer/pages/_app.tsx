import React, { Component, ErrorInfo, ReactNode } from 'react'
import type { AppProps } from 'next/app'

import '../styles/globals.css'

// Error boundary to catch and display React errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0b] text-white p-8">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-rose-400 mb-4">Something went wrong</h1>
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
              <p className="text-rose-300 font-mono text-sm whitespace-pre-wrap">
                {this.state.error?.message || 'Unknown error'}
              </p>
              {this.state.error?.stack && (
                <pre className="mt-4 text-xs text-white/50 overflow-auto">
                  {this.state.error.stack}
                </pre>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded hover:bg-emerald-600"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function MyApp({ Component, pageProps }: AppProps) {
  // Log to confirm app is loading
  React.useEffect(() => {
    console.log('[App] MyApp mounted');
    console.log('[App] IPC available:', !!window.ipc);
  }, []);

  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}

export default MyApp
