export function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
      style={{ background: color }}
    />
  );
}
