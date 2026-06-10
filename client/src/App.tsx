import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C } from './theme/tokens';
import { api, type ArtifactRef } from './lib/api';
import type { View } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { BedrockModal } from './components/BedrockModal';
import { ChatView } from './views/Chat/ChatView';
import { PluginsView } from './views/Plugins/PluginsView';
import { SkillsView } from './views/Skills/SkillsView';
import { ProjectsView } from './views/Projects/ProjectsView';
import { ArtifactsView } from './views/Artifacts/ArtifactsView';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [selArtifact, setSelArtifact] = useState<string | null>(null);
  const [showBedrock, setShowBedrock] = useState(false);
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
  const { data: artifacts } = useQuery({ queryKey: ['artifacts'], queryFn: api.artifacts });
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

  const openConv = (id: string) => {
    setActiveConv(id);
    setView('chat');
    const conv = conversations?.find((c) => c.id === id);
    if (conv && conv.projectId !== activeProjectId) setActiveProject(conv.projectId);
  };

  const onOpenArtifact = (ref: ArtifactRef) => {
    const found =
      artifacts?.find((a) => a.id === ref.artifactId) ??
      artifacts?.find((a) => a.name === ref.name);
    setSelArtifact(found?.id ?? null);
    setView('artifacts');
  };

  const selectedModel = registry?.models.find((m) => m.id === registry.selected);
  const modelLabel = selectedModel ? `${selectedModel.name} · resident` : 'starting…';

  return (
    <div className="h-screen w-full flex" style={{ background: C.win }}>
      <div className="flex w-full h-full" style={{ background: C.bg }}>
        <Sidebar
          view={view}
          setView={setView}
          convs={conversations ?? []}
          activeConv={effectiveConv}
          openConv={openConv}
          newChat={newChat}
          modelLabel={modelLabel}
          ramGB={registry?.hardware.ramGB ?? null}
          userName={userName}
        />
        <div className="flex-1 min-w-0 h-full">
          {view === 'chat' && (
            <ChatView
              convId={effectiveConv}
              registry={registry}
              llamaStatus={health?.llama.status ?? 'starting'}
              llamaError={health?.llama.error ?? null}
              userName={userName}
              activeProjectName={convProject?.name ?? activeProject?.name ?? ''}
              openBedrock={() => setShowBedrock(true)}
              onOpenArtifact={onOpenArtifact}
            />
          )}
          {view === 'plugins' && (
            <PluginsView
              plugins={plugins ?? []}
              projects={projects ?? []}
              activeProject={activeProjectId}
            />
          )}
          {view === 'skills' && <SkillsView skills={skills ?? []} />}
          {view === 'projects' && (
            <ProjectsView
              projects={projects ?? []}
              activeProject={activeProjectId}
              setActiveProject={setActiveProject}
            />
          )}
          {view === 'artifacts' && (
            <ArtifactsView
              artifacts={artifacts ?? []}
              selected={selArtifact}
              setSelected={setSelArtifact}
            />
          )}
        </div>
      </div>
      {showBedrock && <BedrockModal close={() => setShowBedrock(false)} />}
    </div>
  );
}
