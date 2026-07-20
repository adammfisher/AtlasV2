import { useBrand } from '../lib/brand';
import { AxiomLogo } from './AxiomLogo';
import { AtlasLogo } from './AtlasLogo';

/** Picks the active brand's lockup — the one place that needs to know both
 * logos exist, so call sites (Sidebar, LoginView) don't each duplicate the
 * axiom/atlas branch. */
export function BrandLogo({ height }: { height?: number }) {
  const brand = useBrand();
  return brand === 'atlas' ? <AtlasLogo height={height} /> : <AxiomLogo height={height} />;
}
