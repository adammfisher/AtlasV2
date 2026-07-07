import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C } from './theme/tokens';
import { api, type ArtifactRef } from './lib/api';
import type { View } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ArtifactDrawer } from './components/ArtifactDrawer';
import { LivePanel } from './components/LivePanel';
import { Toasts } from './components/Toasts';
import { ChatView } from './views/Chat/ChatView';
import { PluginsView } from './views/Plugins/PluginsView';
import { SkillsView } from './views/Skills/SkillsView';
import { ProjectsView } from './views/Projects/ProjectsView';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<
    { kind: 'detail'; artifactId: string } | { kind: 'list' } | { kind: 'live' } | null
  >(null);
  const [liveGen, setLiveGen] = useState<{ text: string; label: string } | null>(null);
  const queryClient = useQueryClient();

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

  // Open the most recent conversation on first load (mockup parity)
  const effectiveConv = activeConv ?? conversations?.[0]?.id ?? null;

  const activeProjectId = settings?.activeProjectId ?? 'p1';
  const userName = settings?.userName ?? 'Adam';
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

  const newChat = () => {
    void api.createConversation().then((c) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setActiveConv(c.id);
      setView('chat');
    });
  };

  const openConv = (id: string | null) => {
    setActiveConv(id);
    setView('chat');
    if (id === null) return;
    const conv = conversations?.find((c) => c.id === id);
    if (conv && conv.projectId !== activeProjectId) setActiveProject(conv.projectId);
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
    if (ref.artifactId) {
      // the live writing view hands off to the finished document
      setRightPanel((p) => (p === null || p.kind === 'live' ? { kind: 'detail', artifactId: ref.artifactId as string } : p));
    }
  };

  return (
    <div className="flex w-full" style={{ height: '100vh', background: C.bg, overflow: 'hidden' }}>
      <Sidebar
        view={view}
        setView={setView}
        convs={conversations ?? []}
        activeConv={effectiveConv}
        openConv={openConv}
        newChat={newChat}
        registry={registry}
        health={health}
        userName={userName}
      />
      <div className="flex-1 flex min-w-0">
        {view === 'chat' ? (
          <ChatView
            convId={effectiveConv}
            registry={registry}
            userName={userName}
            activeProjectName={convProject?.name ?? activeProject?.name ?? ''}
            onOpenArtifact={onOpenArtifact}
            onOpenArtifactList={() => setRightPanel({ kind: 'list' })}
            onGenStream={onGenStream}
            onArtifactReady={onArtifactReady}
          />
        ) : null}
        {view === 'plugins' ? (
          <PluginsView plugins={plugins ?? []} projects={projects ?? []} activeProject={activeProjectId} />
        ) : null}
        {view === 'skills' ? <SkillsView skills={skills ?? []} /> : null}
        {view === 'projects' ? (
          <ProjectsView
            projects={projects ?? []}
            activeProject={activeProjectId}
            setActiveProject={setActiveProject}
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
          <Toasts />
    </div>
  );
}
