import { useQuery } from '@tanstack/react-query';

export type Brand = 'axiom' | 'atlas';

export const BRAND_NAME: Record<Brand, string> = { axiom: 'Axiom', atlas: 'Atlas' };

/** Deployment-wide display brand (axiom.config.json's `brand` field, served
 * unauthenticated via /api/brand so the login screen picks the right logo
 * before any token exists). Defaults to 'axiom' — the current branding — so
 * an axiom-branded deployment never flashes the wrong logo while the fetch
 * is in flight; an atlas-toggled deployment briefly shows axiom first. */
export function useBrand(): Brand {
  const { data } = useQuery({
    queryKey: ['brand'],
    queryFn: async (): Promise<Brand> => {
      const res = await fetch('/api/brand');
      if (!res.ok) return 'axiom';
      const body = (await res.json()) as { brand?: string };
      return body.brand === 'atlas' ? 'atlas' : 'axiom';
    },
    staleTime: Infinity,
  });
  return data ?? 'axiom';
}
