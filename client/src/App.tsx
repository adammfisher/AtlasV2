import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, wash, applyTheme, currentTheme, type ThemeName } from './theme/tokens';
import { api, type ArtifactRef } from './lib/api';
import { isBusy } from './lib/stream';
import type { View } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ArtifactDrawer } from './components/ArtifactDrawer';
import { LivePanel } from './components/LivePanel';
import { Toasts } from './components/Toasts';
import { ChatView } from './views/Chat/ChatView';
import { PluginsView } from './views/Plugins/PluginsView';
import { SkillsView } from './views/Skills/SkillsView';
import { ArtifactsGallery } from './views/Artifacts/ArtifactsGallery';
import { ProjectsView } from './views/Projects/ProjectsView';
import { LoginView } from './views/Login/LoginView';

/** deep-link: /c/<convId> restores that chat on refresh. */
function convFromUrl(): string | null {
  const m = /^\/c\/([A-Za-z0-9_-]+)/.exec(window.location.pathname);
  return m ? m[1]! : null;
}

export default function App() {
  // simple accounts (users.config.json): a token gates the whole app; the
  // server 401s everything else, so the gate is honest, not cosmetic
  const [signedIn, setSignedIn] = useState<boolean>(() => Boolean(localStorage.getItem('atlas_token')));
  useEffect(() => {
    const onUnauth = () => setSignedIn(false);
    window.addEventListener('atlas-unauth', onUnauth);
    return () => window.removeEventListener('atlas-unauth', onUnauth);
  }, []);
  const [view, setView] = useState<View>('chat');
  const [activeConv, setActiveConv] = useState<string | null>(convFromUrl());
  const [rightPanel, setRightPanel] = useState<
    { kind: 'detail'; artifactId: string } | { kind: 'list' } | { kind: 'live' } | null
  >(null);
  const [liveGen, setLiveGen] = useState<{ text: string; label: string } | null>(null);
  const [autoSend, setAutoSend] = useState<{ convId: string; text: string; attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }> } | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [incognitoConv, setIncognitoConv] = useState<string | null>(null);
  // gallery → chat: artifact to open once the target conversation is active
  const [pendingArtifact, setPendingArtifact] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeName>(currentTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const queryClient = useQueryClient();

  // The inline script in index.html already applied the saved palette before
  // first paint; this re-asserts it on mount so a legacy or absent stored value
  // gets normalized and written back under the new name.
  useEffect(() => applyTheme(theme), []); // initial mount only
  const pickTheme = (next: ThemeName) => {
    // applyTheme only flips [data-theme] — the cascade recolors the tree on its
    // own. setTheme is here purely so the picker re-renders its checkmark.
    applyTheme(next);
    setTheme(next);
  };

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 4_000,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: api.conversations,
  });
  const { data: skills } = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const { data: plugins } = useQuery({ queryKey: ['plugins'], queryFn: api.pluginsDirectory });
  const { data: registry } = useQuery({ queryKey: ['models'], queryFn: api.models });

  // Land on the empty General state, not the most recent chat. A deep link
  // (/c/<id>) still restores that specific chat on refresh; only the bare
  // entry point (sign-in, '/') shows the fresh new-chat view.
  const effectiveConv = activeConv;

  // keep the URL in sync so a refresh restores the current chat (/c/<id>)
  useEffect(() => {
    const path = view === 'chat' && effectiveConv ? `/c/${effectiveConv}` : '/';
    if (window.location.pathname !== path) window.history.replaceState({}, '', path);
  }, [effectiveConv, view]);
  // the artifact/preview panel belongs to a chat — moving to another chat closes
  // it, UNLESS we're navigating specifically to open an artifact (gallery click)
  // or the conversation we just switched TO is actively streaming (the FX-3
  // promotion path: the empty-composer send adopts its new conversation
  // mid-stream, and resetting here would kill the live writing panel)
  useEffect(() => {
    if (isBusy(effectiveConv)) return;
    setLiveGen(null);
    if (pendingArtifact) {
      setRightPanel({ kind: 'detail', artifactId: pendingArtifact });
      setPendingArtifact(null);
    } else {
      setRightPanel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveConv]);
  // back/forward navigation
  useEffect(() => {
    const onPop = () => {
      const id = convFromUrl();
      setActiveConv(id);
      setView('chat');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // global keyboard: Cmd/Ctrl-K focuses chat search (claude.ai parity), Esc is
  // handled per-modal; the focus target carries data-global-search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('input[placeholder*="Search chats"]');
        if (search) search.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeProjectId = settings?.activeProjectId ?? 'p1';
  // No fallback name. This used to default to 'Adam', which meant every OTHER
  // account was greeted by the primary account's owner — a per-account setting
  // silently backstopped by a global one. Undefined here means "we don't know
  // this person's name"; the greeting stays generic rather than guessing.
  const userName = settings?.userName?.trim() || undefined;
  const activeProject = projects?.find((p) => p.id === activeProjectId);
  const currentConv = conversations?.find((c) => c.id === effectiveConv);
  const convProject = projects?.find((p) => p.id === currentConv?.projectId);

  const setActiveProject = (id: string) => {
    queryClient.setQueryData<Record<string, string>>(['settings'], (old) => ({
      ...(old ?? {}),
      activeProjectId: id,
    }));
    void api
      .patchSettings({ activeProjectId: id })
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['settings'] }));
  };

  // apply a project's remembered model when working in it
  const applyProjectModel = (pid?: string) => {
    const proj = projects?.find((p) => p.id === pid);
    if (!proj?.model || !registry) return;
    // bedrockModels is this account's allowlist. A model remembered before the
    // account lost access would 403 here — leave it on its resolved default.
    if (!registry.bedrockModels.some((m) => m.id === proj.model)) return;
    if (registry.selected === proj.model) return;
    void api.selectModel(proj.model).then(() => queryClient.invalidateQueries({ queryKey: ['models'] }));
  };

  const newChat = (
    projectId?: string,
    message?: string,
    attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }>,
    incognito?: boolean,
  ) => {
    // explicit project scoping (no reliance on the async activeProjectId
    // setting) so a new chat's project — and thus its memory scope — is
    // never ambiguous.
    // guard: some onClick handlers may pass an event — only accept a string id
    const scopedPid = typeof projectId === 'string' ? projectId : undefined;
    const msg = typeof message === 'string' ? message : undefined;
    // sidebar New Chat is GENERAL (no project) — only a chat started from a
    // project workspace passes scopedPid and stays in that project
    void api.createConversation(scopedPid, incognito).then((c) => {
      if (incognito) setIncognitoConv(c.id);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (scopedPid) setActiveProject(scopedPid);
      if (msg?.trim()) setAutoSend({ convId: c.id, text: msg.trim(), attachments });
      setActiveConv(c.id);
      setView('chat');
    });
  };

  const openProjectWorkspace = (pid: string) => {
    setActiveProject(pid);
    setOpenProjectId(pid);
    setView('projects');
    applyProjectModel(pid);
  };

  // leaving an incognito chat destroys it (M9: nothing persists) — effect, not
  // openConv: newChat() also switches conversations without going through it
  useEffect(() => {
    if (incognitoConv && effectiveConv !== incognitoConv) {
      void api.deleteConversations([incognitoConv]);
      setIncognitoConv(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveConv]);

  const openConv = (id: string | null) => {
    setActiveConv(id);
    setView('chat');
    if (id === null) return;
    const conv = conversations?.find((c) => c.id === id);
    if (conv && conv.projectId !== activeProjectId) setActiveProject(conv.projectId);
    applyProjectModel(conv?.projectId);
  };

  const onOpenArtifact = (ref: ArtifactRef) => {
    if (ref.artifactId) setRightPanel({ kind: 'detail', artifactId: ref.artifactId });
  };

  const onGenStream = (text: string | null, label: string) => {
    if (text === null) {
      setLiveGen(null);
      setRightPanel((p) => (p?.kind === 'live' ? null : p));
      return;
    }
    setLiveGen({ text, label });
    setRightPanel((p) => (p === null || p.kind === 'live' ? { kind: 'live' } : p));
  };

  const onArtifactReady = (ref: ArtifactRef) => {
    // claude.ai parity: a freshly generated artifact always opens on the right,
    // handing off from the live writing view (or replacing an older artifact).
    if (ref.artifactId) {
      // an EDIT adds a version — the open panel must not show a stale list (C10)
      void queryClient.invalidateQueries({ queryKey: ['artifact', ref.artifactId] });
      setRightPanel({ kind: 'detail', artifactId: ref.artifactId });
    }
  };

  // sign-in lands on the General empty state — clear any stale /c/<id> path
  // (e.g. a previous session's chat) so we don't reopen someone else's chat
  if (!signedIn)
    return <LoginView onSignedIn={() => { window.location.href = '/'; }} />;

  return (
    <div className="flex w-full" style={{ height: '100vh', background: C.bg, overflow: 'hidden' }}>
      {/* mobile: hamburger + drawer; desktop: static sidebar */}
      <button
        onClick={() => setSidebarOpen((o) => !o)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg"
        style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}` }}
        title="Menu"
      >
        <Menu size={16} />
      </button>
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-30" style={{ background: C.scrim }} onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`${sidebarOpen ? 'max-md:flex' : 'max-md:hidden'} max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 md:flex md:static`}>
        <Sidebar
          view={view}
          setView={(v) => {
            setView(v);
            setSidebarOpen(false);
          }}
          convs={conversations ?? []}
          activeConv={effectiveConv}
          openConv={(id) => {
            openConv(id);
            setSidebarOpen(false);
          }}
          newChat={newChat}
          registry={registry}
          health={health}
          userName={userName}
          theme={theme}
          onPickTheme={pickTheme}
        />
      </div>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {view === 'chat' && incognitoConv === effectiveConv && incognitoConv !== null ? (
          <div
            className="px-4 py-1.5 text-xs text-center"
            style={{ background: wash(C.purple, 15), color: C.purple, borderBottom: `1px solid ${wash(C.purple, 30)}` }}
          >
            Incognito chat — not saved to recents, no memory capture, deleted when you leave
          </div>
        ) : null}
        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
        {view === 'chat' ? (
          <ChatView
            convId={effectiveConv}
            registry={registry}
            userName={userName}
            activeProjectName={convProject?.name ?? (effectiveConv ? activeProject?.name : 'General') ?? 'General'}
            onOpenArtifact={onOpenArtifact}
            onOpenArtifactList={() => setRightPanel({ kind: 'list' })}
            onGenStream={onGenStream}
            onArtifactReady={onArtifactReady}
            autoSend={autoSend}
            onAutoSendConsumed={() => setAutoSend(null)}
            onOpenProject={openProjectWorkspace}
            onConvCreated={(id) => {
              // a send from the empty composer created this conversation —
              // adopt it so the URL/view follow the in-flight stream (FX-3)
              void queryClient.invalidateQueries({ queryKey: ['conversations'] });
              setActiveConv(id);
            }}
          />
        ) : null}
        {view === 'plugins' ? (
          <PluginsView plugins={plugins ?? []} projects={projects ?? []} activeProject={activeProjectId} />
        ) : null}
        {view === 'skills' ? <SkillsView skills={skills ?? []} /> : null}
        {view === 'artifacts' ? (
          <ArtifactsGallery
            projects={projects ?? []}
            onOpen={(convId, artifactId) => {
              setView('chat');
              // same conv (or no conv link): open the panel directly. Different
              // conv: stash it and let the conv-change effect open it after nav
              if (convId && convId !== effectiveConv) {
                setPendingArtifact(artifactId);
                setActiveConv(convId);
              } else {
                setRightPanel({ kind: 'detail', artifactId });
              }
            }}
          />
        ) : null}
        {view === 'projects' ? (
          <ProjectsView
            projects={projects ?? []}
            conversations={conversations ?? []}
            activeProject={activeProjectId}
            setActiveProject={setActiveProject}
            openConversation={(id) => openConv(id)}
            newChatInProject={(pid, message, attachments) => newChat(pid, message, attachments)}
            openProjectId={openProjectId}
            setOpenProjectId={setOpenProjectId}
          />
        ) : null}
        {view === 'chat' && rightPanel?.kind === 'detail' ? (
          <ArtifactPanel artifactId={rightPanel.artifactId} onClose={() => setRightPanel(null)} />
        ) : null}
        {view === 'chat' && rightPanel?.kind === 'live' && liveGen ? (
          <LivePanel text={liveGen.text} label={liveGen.label} onClose={() => setRightPanel(null)} />
        ) : null}
        {view === 'chat' && rightPanel?.kind === 'list' ? (
          <ArtifactDrawer
            convId={effectiveConv}
            onSelect={(id) => setRightPanel({ kind: 'detail', artifactId: id })}
            onClose={() => setRightPanel(null)}
          />
        ) : null}
        </div>
      </div>
          <Toasts />
    </div>
  );
}
