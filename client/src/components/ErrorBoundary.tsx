import { Component, type ReactNode } from 'react';
import { C, sans } from '../theme/tokens';

interface State {
  error: Error | null;
}

/** A component crash degrades to an honest inline error, never a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-xl px-4 py-3 text-sm" style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}>
          Something broke in the UI: {this.state.error.message}
          <button
            onClick={() => this.setState({ error: null })}
            className="ml-3 px-2 py-1 rounded text-xs"
            style={{ background: C.raised, color: C.text }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
