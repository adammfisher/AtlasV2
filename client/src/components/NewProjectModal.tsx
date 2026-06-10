import { useState } from 'react';
import { X } from 'lucide-react';
import { C, sans } from '../theme/tokens';

export function NewProjectModal({
  close,
  create,
}: {
  close: () => void;
  create: (name: string, instructions: string) => void;
}) {
  const [name, setName] = useState('');
  const [inst, setInst] = useState('');
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 mx-4"
        style={{ background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
            New project
          </div>
          <X size={16} className="cursor-pointer" style={{ color: C.mute }} onClick={close} />
        </div>
        <div className="mt-4 text-xs font-medium uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
          Name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Q4 Planning"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.panel, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
        />
        <div className="mt-3 text-xs font-medium uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
          Instructions
        </div>
        <textarea
          value={inst}
          onChange={(e) => setInst(e.target.value)}
          rows={3}
          placeholder="Persistent system prompt for every chat in this project…"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ background: C.panel, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
        />
        <div className="text-xs mt-1" style={{ color: C.mute, fontFamily: sans }}>
          Memory, files, templates, and plugins will be scoped to this project with hard isolation.
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={close}
            className="text-sm px-3.5 py-2 rounded-lg"
            style={{ color: C.sub, border: `1px solid ${C.border}`, fontFamily: sans }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (name.trim()) {
                create(name.trim(), inst.trim());
                close();
              }
            }}
            className="text-sm px-3.5 py-2 rounded-lg font-medium"
            style={{ background: C.accent, color: '#fff', opacity: name.trim() ? 1 : 0.5, fontFamily: sans }}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
