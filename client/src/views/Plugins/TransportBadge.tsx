import { Terminal, Globe } from 'lucide-react';
import { C } from '../../theme/tokens';
import { Badge } from '../../components/Badge';

export function TransportBadge({ t }: { t: string }) {
  const stdio = t === 'stdio';
  return (
    <Badge color={stdio ? C.green : C.blue} dim={stdio ? C.greenDim : C.blueDim} icon={stdio ? Terminal : Globe}>
      {stdio ? 'stdio · local' : 'streamable-http'}
    </Badge>
  );
}
