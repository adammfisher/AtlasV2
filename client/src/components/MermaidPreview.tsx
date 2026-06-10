import { C } from '../theme/tokens';

/* Stage 1 placeholder frame — Stage 3 swaps in the real sandboxed mermaid render (PRD A18). */
export function MermaidPreview() {
  const Node = ({ label }: { label: string }) => (
    <div
      className="px-3 py-2 rounded-lg text-xs whitespace-nowrap"
      style={{ background: C.raise2, color: C.text, border: `1px solid ${C.border}` }}
    >
      {label}
    </div>
  );
  const Arrow = () => <span style={{ color: C.faint }}>→</span>;
  return (
    <div
      className="mt-3 rounded-xl px-4 py-4 flex items-center gap-2.5 flex-wrap"
      style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
    >
      <Node label="Ingest" />
      <Arrow />
      <Node label="Embed · sqlite-vec" />
      <Arrow />
      <Node label="Graph store" />
      <Arrow />
      <Node label="MCP tools" />
    </div>
  );
}
