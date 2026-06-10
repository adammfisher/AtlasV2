import { Loader2 } from 'lucide-react';
import { C } from '../theme/tokens';
import { Dot } from './Dot';

export function StatusBadge({ status }: { status: string }) {
  if (status === 'connected')
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ background: C.greenDim, color: C.green }}
      >
        <Dot color={C.green} />
        Connected
      </span>
    );
  if (status === 'installing')
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap"
        style={{ background: C.raise, color: C.dim }}
      >
        <Loader2 size={10} className="animate-spin" />
        Installing
      </span>
    );
  if (status === 'planned')
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ background: C.amberDim, color: C.amber }}
      >
        <Dot color={C.amber} />
        Planned
      </span>
    );
  if (status === 'error')
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ background: 'rgba(201,124,112,0.15)', color: C.red }}
      >
        <Dot color={C.red} />
        Error
      </span>
    );
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: C.raise, color: C.dim }}
    >
      Available
    </span>
  );
}
