import { useState } from "react";
import {
  Plus, Search, FolderKanban, Puzzle, Sparkles, ChevronDown, ChevronRight,
  X, Check, CheckCircle2, Download, Copy, Globe, Terminal, Zap, Database,
  FileText, FileSpreadsheet, Presentation, FileCode2, Braces, ShieldCheck,
  Lock, Cpu, Server, ArrowUp, Paperclip, Layers, BookOpen, Network,
  ExternalLink, AlertCircle, Wrench, Clock, MessageSquare, KeyRound,
  GitBranch, Building2, Box, Eye, Settings2, HardDrive, Mic, Info
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Atlas palette — modeled on Claude.ai's warm dark theme              */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#262624",
  sidebar: "#1f1e1c",
  panel: "#2f2e2b",
  panelHover: "#363430",
  raised: "#383631",
  border: "#3c3a36",
  borderSoft: "rgba(255,255,255,0.06)",
  text: "#f0eee6",
  sub: "#b8b4a9",
  mute: "#85827a",
  accent: "#d97757",
  accentDim: "rgba(217,119,87,0.14)",
  green: "#8fbf7f",
  greenDim: "rgba(143,191,127,0.13)",
  blue: "#82a8c8",
  blueDim: "rgba(130,168,200,0.13)",
  purple: "#a995c9",
  purpleDim: "rgba(169,149,201,0.13)",
  amber: "#d4ad6a",
  amberDim: "rgba(212,173,106,0.13)",
};
const serif = '"Tiempos Text", Georgia, "Times New Roman", serif';
const sans = 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
const PROJECTS = [
  { id: "p1", name: "Lightspeed Atlas", chats: 14, templates: 3, plugins: 4, instructions: "Enterprise rollout workspace. Prefer Lightspeed deck template; cite Jira keys.", shared: false },
  { id: "p2", name: "Client Alpha — QBR", chats: 6, templates: 2, plugins: 2, instructions: "Confidential. Hard isolation; never reference other client work.", shared: false },
  { id: "p3", name: "Internal Ops", chats: 22, templates: 1, plugins: 3, instructions: "Ops runbooks and weekly reporting.", shared: true },
];

const RECENTS = [
  "Q3 business review deck",
  "Office pipeline validation gates",
  "Knowledge Core connector spec",
  "Budget model — FY27 scenarios",
  "Redline: MSA section 4.2",
  "Onboarding site preview build",
  "Org chart traversal queries",
];

const MODELS = [
  { id: "auto", name: "Auto", detail: "Routes by task — E2B classifies, 12B drafts", badge: "Recommended" },
  { id: "e2b", name: "Gemma 4 E2B", detail: "Router · 3.1 GB · always resident", badge: "On-device" },
  { id: "e4b", name: "Gemma 4 E4B", detail: "Chat · 5.0 GB · low-RAM default", badge: "On-device" },
  { id: "12b", name: "Gemma 4 12B", detail: "Drafting, office JSON, code · 7.1 GB", badge: "On-device" },
  { id: "bedrock", name: "Claude · Bedrock", detail: "Quality upgrade for office + code", badge: "Add model", locked: true },
];

const SKILLS = [
  {
    id: "pptx", name: "Presentations", ext: ".pptx", icon: Presentation, color: C.accent, dim: C.accentDim,
    triggers: "presentation · slides · deck · QBR",
    meta: 98, full: 4200, helper: "build_pptx.py",
    validators: ["openxml-audit schema", "python-pptx round-trip", "placeholder grep", "thumbnail grid (when soffice present)"],
    tier: "12B → Bedrock", note: "Model emits slide JSON under constrained decoding; helper fills branded .potx placeholders.",
  },
  {
    id: "docx", name: "Documents", ext: ".docx", icon: FileText, color: C.blue, dim: C.blueDim,
    triggers: "document · report · letter · redline",
    meta: 92, full: 3800, helper: "build_docx.py",
    validators: ["openxml-audit schema", "python-docx round-trip", "markitdown Jinja grep"],
    tier: "12B → Bedrock", note: "docxtpl Jinja templates or python-docx primitives; tracked-changes via OOXML edit.",
  },
  {
    id: "xlsx", name: "Spreadsheets", ext: ".xlsx", icon: FileSpreadsheet, color: C.green, dim: C.greenDim,
    triggers: "spreadsheet · model · budget · forecast",
    meta: 104, full: 4600, helper: "build_xlsx.py",
    validators: ["openxml-audit schema", "openpyxl round-trip", "formula syntax check", "soffice recalc #REF!/#DIV/0! (opportunistic)"],
    tier: "12B → Bedrock", note: "Cell/formula/format JSON into openpyxl. Recalc degrades gracefully when soffice is absent.",
  },
  {
    id: "pdf", name: "PDF", ext: ".pdf", icon: BookOpen, color: C.purple, dim: C.purpleDim,
    triggers: "pdf · form · fill · extract",
    meta: 88, full: 3100, helper: "build_pdf.py",
    validators: ["pdfplumber text grep", "page-count assert"],
    tier: "12B", note: "weasyprint default (pure-Python HTML→PDF); reportlab for programmatic layouts; pdfplumber extraction.",
  },
  {
    id: "md", name: "Markdown", ext: ".md", icon: FileCode2, color: C.sub, dim: "rgba(184,180,169,0.10)",
    triggers: "notes · readme · spec",
    meta: 60, full: 900, helper: "static HTML via bundled marked.js",
    validators: ["render check"],
    tier: "E4B / 12B", note: "Emitted directly; rendered as a static-HTML artifact — no bundler involved.",
  },
  {
    id: "mermaid", name: "Mermaid", ext: ".mmd", icon: GitBranch, color: C.amber, dim: C.amberDim,
    triggers: "flowchart · sequence · ERD",
    meta: 72, full: 1800, helper: "bundled mermaid.js (sandboxed iframe)",
    validators: ["parse check", "render check"],
    tier: "12B", note: "Diagram source validated by a local parse pass before render.",
  },
  {
    id: "svg", name: "SVG", ext: ".svg", icon: Layers, color: C.blue, dim: C.blueDim,
    triggers: "icon · illustration · figure",
    meta: 66, full: 1500, helper: "resvg / sharp rasterization",
    validators: ["XML well-formed", "viewBox assert"],
    tier: "12B", note: "Rasterized locally when embedding into decks or PDFs.",
  },
  {
    id: "react", name: "React & preview sites", ext: ".jsx", icon: Braces, color: C.accent, dim: C.accentDim,
    triggers: "component · app · landing page · preview site",
    meta: 110, full: 4900, helper: "esbuild-wasm local bundler (Web Worker)",
    validators: ["esbuild compile", "CSP-locked iframe render", "zero external network calls"],
    tier: "12B → Bedrock", note: "Multi-file virtual FS, local importmap React, sandboxed iframe. Fully air-gapped.",
  },
];

const PLUGIN_SEED = [
  {
    id: "knowledge-core", name: "Knowledge Core", vendor: "atlas-org-intel", featured: true,
    icon: Network, color: C.accent, dim: C.accentDim,
    transport: "streamable-http", endpoint: "http://127.0.0.1:7979/mcp",
    status: "available", desc: "Org-wide semantic + graph intelligence over Confluence and Jira. Ask who knows what, trace decisions, find experts.",
    tools: ["org_search", "org_ask", "org_get_entity", "org_traverse", "org_find_experts", "org_recent_activity"],
    creds: [{ key: "ORG_INTEL_KEY", label: "Service API key" }],
    runtime: "Standalone Node service (peer MCP server)",
  },
  {
    id: "filesystem", name: "Filesystem", vendor: "Atlas built-in",
    icon: HardDrive, color: C.green, dim: C.greenDim,
    transport: "stdio", endpoint: "bundled Node runtime",
    status: "bundled", enabled: true, desc: "Scoped read/write on project-bound folders with explicit permission gates and audit logging.",
    tools: ["read_file", "write_file", "list_directory", "search_files", "move_file"],
    creds: [], runtime: "runtimes/node (portable folder)",
  },
  {
    id: "atlas-memory", name: "Atlas Memory", vendor: "Atlas built-in",
    icon: Database, color: C.purple, dim: C.purpleDim,
    transport: "stdio", endpoint: "bundled CPython runtime",
    status: "bundled", enabled: true, desc: "Four-layer memory: asserted facts, semantic recall (sqlite-vec), knowledge graph, project RAG — exposed as MCP tools.",
    tools: ["memory.search", "memory.upsert", "graph.query", "graph.add_fact"],
    creds: [], runtime: "runtimes/python (portable folder)",
  },
  {
    id: "jira", name: "Jira", vendor: "Atlassian",
    icon: Box, color: C.blue, dim: C.blueDim,
    transport: "streamable-http", endpoint: "https://mcp.atlassian.com/v1/jira",
    status: "available", desc: "Issues, sprints, and boards. Read and update tickets from chat with per-project scoping.",
    tools: ["search_issues", "get_issue", "create_issue", "transition_issue"],
    creds: [{ key: "ATLASSIAN_TOKEN", label: "OAuth / API token" }], runtime: "Remote (SSRF allowlisted)",
  },
  {
    id: "confluence", name: "Confluence", vendor: "Atlassian",
    icon: BookOpen, color: C.blue, dim: C.blueDim,
    transport: "streamable-http", endpoint: "https://mcp.atlassian.com/v1/confluence",
    status: "available", desc: "Search and read spaces and pages; cite sources back into project knowledge.",
    tools: ["search_pages", "get_page", "list_spaces"],
    creds: [{ key: "ATLASSIAN_TOKEN", label: "OAuth / API token" }], runtime: "Remote (SSRF allowlisted)",
  },
  {
    id: "github", name: "GitHub", vendor: "GitHub",
    icon: GitBranch, color: C.text, dim: "rgba(240,238,230,0.08)",
    transport: "stdio", endpoint: "bundled Node runtime",
    status: "installed", enabled: false, desc: "Repos, PRs, issues, and code search through the bundled runtime — no global npx required.",
    tools: ["search_code", "get_pr", "list_issues", "create_issue"],
    creds: [{ key: "GITHUB_PAT", label: "Personal access token" }], runtime: "runtimes/node (portable folder)",
  },
  {
    id: "slack", name: "Slack", vendor: "Slack",
    icon: MessageSquare, color: C.amber, dim: C.amberDim,
    transport: "streamable-http", endpoint: "https://mcp.slack.com/v1",
    status: "available", desc: "Search channels and threads; draft and post messages with confirmation gates.",
    tools: ["search_messages", "post_message", "list_channels"],
    creds: [{ key: "SLACK_TOKEN", label: "Bot token" }], runtime: "Remote (SSRF allowlisted)",
  },
  {
    id: "postgres", name: "PostgreSQL", vendor: "Community (vetted)",
    icon: Server, color: C.green, dim: C.greenDim,
    transport: "stdio", endpoint: "bundled Node runtime",
    status: "available", desc: "Read-only SQL over allowlisted databases. Results stream into spreadsheets and analyses.",
    tools: ["query", "list_schemas", "describe_table"],
    creds: [{ key: "PG_CONN", label: "Connection string" }], runtime: "runtimes/node (portable folder)",
  },
];

const SLIDES = [
  { t: "title", h: "Q3 Business Review" },
  { t: "bullets", h: "Executive summary" },
  { t: "chart", h: "Revenue vs plan" },
  { t: "two", h: "Pipeline by segment" },
  { t: "chart", h: "Win rate — punchier" },
  { t: "bullets", h: "Risks & asks" },
];

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */
function Badge({ children, color, dim, icon: Icon }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ color, background: dim, fontFamily: sans }}>
      {Icon ? <Icon size={11} /> : null}{children}
    </span>
  );
}

function Toggle({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="relative rounded-full transition-colors flex-shrink-0"
      style={{ width: 36, height: 20, background: on ? C.accent : C.raised, opacity: disabled ? 0.45 : 1, border: `1px solid ${on ? C.accent : C.border}` }}>
      <span className="absolute rounded-full transition-all"
        style={{ width: 14, height: 14, top: 2, left: on ? 18 : 2, background: on ? "#fff" : C.sub }} />
    </button>
  );
}

function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left"
      style={{ color: active ? C.text : C.sub, background: active ? C.panel : "transparent", fontFamily: sans }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      <Icon size={16} strokeWidth={1.8} style={{ color: active ? C.accent : C.mute }} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? <span className="text-xs px-1.5 rounded-full" style={{ color: C.accent, background: C.accentDim }}>{badge}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */
function Sidebar({ view, setView }) {
  return (
    <div className="flex flex-col h-full" style={{ width: 264, background: C.sidebar, borderRight: `1px solid ${C.borderSoft}` }}>
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <span style={{ fontFamily: serif, fontSize: 21, color: C.text, letterSpacing: "-0.01em" }}>Atlas</span>
        <Badge color={C.green} dim={C.greenDim} icon={Lock}>Local</Badge>
      </div>

      <div className="px-2.5">
        <button onClick={() => setView("chat")}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ color: C.accent, fontFamily: sans }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentDim)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <span className="flex items-center justify-center rounded-full" style={{ width: 22, height: 22, background: C.accent }}>
            <Plus size={13} color="#fff" strokeWidth={2.5} />
          </span>
          New chat
        </button>
      </div>

      <div className="px-2.5 mt-1 flex flex-col gap-0.5">
        <NavItem icon={MessageSquare} label="Chats" active={view === "chat"} onClick={() => setView("chat")} />
        <NavItem icon={FolderKanban} label="Projects" active={view === "projects"} onClick={() => setView("projects")} />
        <NavItem icon={Puzzle} label="Plugins" active={view === "plugins"} onClick={() => setView("plugins")} badge="MCP" />
        <NavItem icon={Sparkles} label="Skills" active={view === "skills"} onClick={() => setView("skills")} />
      </div>

      <div className="px-4 mt-5 mb-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
        Recents
      </div>
      <div className="px-2.5 flex-1 overflow-y-auto flex flex-col gap-0.5 pb-2">
        {RECENTS.map((r, i) => (
          <button key={i} onClick={() => setView("chat")}
            className="text-left px-2.5 py-1.5 rounded-lg text-sm truncate transition-colors"
            style={{ color: i === 0 && view === "chat" ? C.text : C.sub, background: i === 0 && view === "chat" ? C.panel : "transparent", fontFamily: sans }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = i === 0 && view === "chat" ? C.panel : "transparent")}>
            {r}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={13} style={{ color: C.green }} />
            <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>llama-server</span>
            <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>9.4 / 32 GB</span>
          </div>
          {[
            { n: "E2B router", w: "22%", on: true },
            { n: "12B drafting", w: "48%", on: true },
            { n: "E4B", w: "0%", on: false },
          ].map((m) => (
            <div key={m.n} className="flex items-center gap-2 py-0.5">
              <span className="text-xs w-20 truncate" style={{ color: m.on ? C.sub : C.mute, fontFamily: sans }}>{m.n}</span>
              <div className="flex-1 rounded-full" style={{ height: 4, background: C.raised }}>
                <div className="rounded-full" style={{ height: 4, width: m.w, background: m.on ? C.green : C.border }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 px-1.5 pt-2.5">
          <span className="flex items-center justify-center rounded-full text-xs font-semibold"
            style={{ width: 26, height: 26, background: C.raised, color: C.text, fontFamily: sans }}>AF</span>
          <span className="text-sm" style={{ color: C.text, fontFamily: sans }}>Adam</span>
          <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>· Enterprise</span>
          <Settings2 size={15} className="ml-auto cursor-pointer" style={{ color: C.mute }} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chat view                                                           */
/* ------------------------------------------------------------------ */
function StepRow({ ok, warn, label, detail }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {warn ? <AlertCircle size={14} style={{ color: C.amber, marginTop: 2 }} />
        : ok ? <CheckCircle2 size={14} style={{ color: C.green, marginTop: 2 }} />
          : <Clock size={14} style={{ color: C.mute, marginTop: 2 }} />}
      <span className="text-xs" style={{ color: C.sub, fontFamily: sans }}>
        <span style={{ color: C.text }}>{label}</span>{detail ? <span style={{ color: C.mute }}> — {detail}</span> : null}
      </span>
    </div>
  );
}

function PipelineCard() {
  return (
    <div className="rounded-xl px-3.5 py-3 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Zap size={13} style={{ color: C.accent }} />
        <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>Document pipeline</span>
        <Badge color={C.accent} dim={C.accentDim}>pptx skill</Badge>
        <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>11.8s</span>
      </div>
      <StepRow ok label="Router · Gemma 4 E2B" detail="intent: create_doc · skill: pptx · 12 ms" />
      <StepRow ok label="Skill loaded" detail="pptx playbook · 4.2k tokens" />
      <StepRow ok label="Template" detail="Lightspeed — Client Deck.potx · 14 placeholders" />
      <StepRow ok label="Gemma 4 12B · slide JSON" detail="constrained json_schema · valid first pass" />
      <StepRow ok label="build_pptx.py" detail="12 slides filled" />
      <StepRow ok label="openxml-audit · round-trip · placeholder grep" detail="all clean" />
      <StepRow warn label="soffice recalc" detail="skipped — LibreOffice not present on this machine" />
    </div>
  );
}

function ArtifactCard({ onOpen, version }) {
  return (
    <button onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
      style={{ background: C.panel, border: `1px solid ${C.border}` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}>
      <span className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 38, height: 38, background: C.accentDim }}>
        <Presentation size={18} style={{ color: C.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>Q3-Business-Review.pptx</span>
        <span className="block text-xs" style={{ color: C.mute, fontFamily: sans }}>12 slides · Lightspeed template · {version}</span>
      </span>
      <Eye size={15} style={{ color: C.mute }} />
    </button>
  );
}

function Msg({ who, children }) {
  if (who === "user") {
    return (
      <div className="flex justify-end mb-5">
        <div className="rounded-2xl px-4 py-2.5 max-w-md text-sm leading-relaxed"
          style={{ background: C.panel, color: C.text, fontFamily: sans, border: `1px solid ${C.borderSoft}` }}>
          {children}
        </div>
      </div>
    );
  }
  return <div className="mb-6 max-w-2xl">{children}</div>;
}

function ModelMenu({ selected, onSelect, onClose }) {
  return (
    <div className="absolute bottom-12 right-0 rounded-xl py-1.5 z-20 shadow-2xl"
      style={{ width: 300, background: C.raised, border: `1px solid ${C.border}` }}>
      {MODELS.map((m) => (
        <button key={m.id} onClick={() => { if (!m.locked) { onSelect(m.id); onClose(); } }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          style={{ opacity: m.locked ? 0.55 : 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>{m.name}</span>
              <Badge color={m.id === "bedrock" ? C.blue : C.green} dim={m.id === "bedrock" ? C.blueDim : C.greenDim}>{m.badge}</Badge>
            </span>
            <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>{m.detail}</span>
          </span>
          {m.locked ? <KeyRound size={14} style={{ color: C.mute }} /> : selected === m.id ? <Check size={15} style={{ color: C.accent }} /> : null}
        </button>
      ))}
      <div className="px-3 pt-1.5 mt-1 text-xs flex items-center gap-1.5" style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.mute, fontFamily: sans }}>
        <Info size={12} /> Bedrock unlocks after AWS credentials are added in Settings.
      </div>
    </div>
  );
}

function ChatView({ onOpenArtifact }) {
  const [model, setModel] = useState("auto");
  const [menu, setMenu] = useState(false);
  const m = MODELS.find((x) => x.id === model);
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <span className="text-sm" style={{ color: C.mute, fontFamily: sans }}>Lightspeed Atlas</span>
        <ChevronRight size={13} style={{ color: C.mute }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>Q3 business review deck</span>
        <Badge color={C.purple} dim={C.purpleDim} icon={FolderKanban}>Project</Badge>
        <span className="ml-auto" />
        <Badge color={C.green} dim={C.greenDim} icon={Lock}>On-device · no data leaves this machine</Badge>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <Msg who="user">Create a Q3 business review deck from the project metrics — use the Lightspeed template.</Msg>
          <Msg who="assistant">
            <PipelineCard />
            <p className="text-sm leading-relaxed mb-3" style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
              Here's the Q3 review deck — 12 slides on the Lightspeed template, with the revenue and pipeline
              charts built from the project metrics file. Formatting, theme colors, and the master come straight
              from the template; I only filled placeholders.
            </p>
            <ArtifactCard onOpen={onOpenArtifact} version="v1" />
          </Msg>
          <Msg who="user">Make the win-rate slide punchier.</Msg>
          <Msg who="assistant">
            <div className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
              <StepRow ok label="Targeted edit" detail="slides[4] regenerated only · re-validated · v2" />
            </div>
            <p className="text-sm leading-relaxed mb-3" style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
              Tightened it to one headline stat — win rate up 9 points — with a single supporting bar pair and a
              one-line takeaway. The rest of the deck is untouched.
            </p>
            <ArtifactCard onOpen={onOpenArtifact} version="v2" />
          </Msg>
        </div>
      </div>

      <div className="px-6 pb-5">
        <div className="max-w-2xl mx-auto relative rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <textarea rows={2} placeholder="Message Atlas…" className="w-full bg-transparent px-4 pt-3.5 text-sm outline-none resize-none"
            style={{ color: C.text, fontFamily: sans }} />
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            <button className="p-1.5 rounded-lg" style={{ color: C.mute }}><Paperclip size={16} /></button>
            <button className="p-1.5 rounded-lg" style={{ color: C.mute }}><Sparkles size={16} /></button>
            <span className="ml-auto relative">
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
                style={{ color: C.sub, fontFamily: sans }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {m.name}<ChevronDown size={13} />
              </button>
              {menu ? <ModelMenu selected={model} onSelect={setModel} onClose={() => setMenu(false)} /> : null}
            </span>
            <button className="p-1.5 rounded-lg" style={{ color: C.mute }}><Mic size={16} /></button>
            <button className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: C.accent }}>
              <ArrowUp size={16} color="#fff" strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <p className="text-center text-xs mt-2.5" style={{ color: C.mute, fontFamily: sans }}>
          Atlas runs on this machine. Models: Gemma 4 E2B · E4B · 12B — Bedrock optional.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Artifact panel                                                      */
/* ------------------------------------------------------------------ */
function MiniSlide({ s, active }) {
  return (
    <div className="rounded-md p-2 flex flex-col gap-1"
      style={{ aspectRatio: "16/9", background: "#f5f2ea", border: active ? `2px solid ${C.accent}` : `1px solid ${C.border}` }}>
      <div style={{ height: 5, width: s.t === "title" ? "70%" : "50%", background: "#c96a47", borderRadius: 2, marginTop: s.t === "title" ? "26%" : 0 }} />
      {s.t === "bullets" ? (
        <>
          <div style={{ height: 3, width: "80%", background: "#9a958a", borderRadius: 2 }} />
          <div style={{ height: 3, width: "72%", background: "#9a958a", borderRadius: 2 }} />
          <div style={{ height: 3, width: "64%", background: "#9a958a", borderRadius: 2 }} />
        </>
      ) : null}
      {s.t === "chart" ? (
        <div className="flex items-end gap-1 flex-1 pb-0.5">
          {[40, 65, 50, 85, 70].map((h, i) => (
            <div key={i} style={{ width: 7, height: `${h}%`, background: i === 3 ? "#c96a47" : "#b8b2a4", borderRadius: 1 }} />
          ))}
        </div>
      ) : null}
      {s.t === "two" ? (
        <div className="flex gap-1.5 flex-1">
          <div className="flex-1 rounded-sm" style={{ background: "#e4dfd2" }} />
          <div className="flex-1 rounded-sm" style={{ background: "#e4dfd2" }} />
        </div>
      ) : null}
    </div>
  );
}

function ArtifactPanel({ onClose }) {
  const [ver, setVer] = useState("v2");
  return (
    <div className="flex flex-col h-full flex-shrink-0" style={{ width: 380, background: "#21201e", borderLeft: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <Presentation size={15} style={{ color: C.accent }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>Q3-Business-Review.pptx</span>
        <span className="ml-auto flex items-center gap-1">
          {["v1", "v2"].map((v) => (
            <button key={v} onClick={() => setVer(v)} className="px-2 py-0.5 rounded-md text-xs font-medium"
              style={{ color: ver === v ? C.text : C.mute, background: ver === v ? C.raised : "transparent", fontFamily: sans }}>{v}</button>
          ))}
        </span>
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: C.mute }}><X size={15} /></button>
      </div>
      <div className="px-4 py-3 grid grid-cols-2 gap-2.5 overflow-y-auto">
        {SLIDES.map((s, i) => <MiniSlide key={i} s={s} active={ver === "v2" && i === 4} />)}
      </div>
      <div className="px-4 py-3 mt-auto" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>Validation</div>
        <StepRow ok label="openxml-audit" detail="schema-valid" />
        <StepRow ok label="python-pptx round-trip" detail="12 slides · text intact" />
        <StepRow ok label="Placeholder grep" detail="no leftover {{ }} tags" />
        <StepRow warn label="soffice recalc / thumbnails" detail="skipped — not installed" />
        <div className="flex gap-2 mt-3">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: "#fff", fontFamily: sans }}>
            <Download size={14} /> Download
          </button>
          <button className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm"
            style={{ background: C.raised, color: C.sub, fontFamily: sans, border: `1px solid ${C.border}` }}>
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plugins (MCP directory)                                             */
/* ------------------------------------------------------------------ */
function TransportBadge({ t }) {
  const stdio = t === "stdio";
  return (
    <Badge color={stdio ? C.green : C.blue} dim={stdio ? C.greenDim : C.blueDim} icon={stdio ? Terminal : Globe}>
      {stdio ? "stdio · local" : "streamable-http"}
    </Badge>
  );
}

function PluginCard({ p, onOpen, onInstall }) {
  const Icon = p.icon;
  return (
    <div className="rounded-xl p-4 flex flex-col gap-2.5 transition-colors cursor-pointer"
      style={{ background: C.panel, border: `1px solid ${p.featured ? C.accent : C.border}` }}
      onClick={() => onOpen(p.id)}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}>
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 36, height: 36, background: p.dim }}>
          <Icon size={18} style={{ color: p.color }} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>{p.name}</span>
            {p.featured ? <Badge color={C.accent} dim={C.accentDim}>Featured</Badge> : null}
          </span>
          <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>{p.vendor}</span>
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans, minHeight: 44 }}>{p.desc}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <TransportBadge t={p.transport} />
        <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>{p.tools.length} tools</span>
      </div>
      <div className="flex items-center gap-2 pt-1" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        {p.status === "bundled" ? (
          <>
            <Badge color={C.green} dim={C.greenDim} icon={ShieldCheck}>Bundled</Badge>
            <span className="text-xs ml-auto" style={{ color: p.enabled ? C.green : C.mute, fontFamily: sans }}>{p.enabled ? "Enabled" : "Disabled"}</span>
          </>
        ) : p.status === "installed" ? (
          <>
            <Badge color={C.blue} dim={C.blueDim} icon={Check}>Installed</Badge>
            <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>Configure →</span>
          </>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onInstall(p.id); }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: p.featured ? C.accent : C.raised, color: p.featured ? "#fff" : C.text, fontFamily: sans, border: p.featured ? "none" : `1px solid ${C.border}` }}>
            <Download size={12} /> Install
          </button>
        )}
      </div>
    </div>
  );
}

function PluginModal({ p, onClose, projEnabled, toggleProj }) {
  const Icon = p.icon;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl w-full overflow-hidden flex flex-col" style={{ maxWidth: 560, maxHeight: "88%", background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <span className="flex items-center justify-center rounded-xl" style={{ width: 42, height: 42, background: p.dim }}>
            <Icon size={20} style={{ color: p.color }} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>{p.name}</span>
              <TransportBadge t={p.transport} />
            </span>
            <span className="block text-xs" style={{ color: C.mute, fontFamily: sans }}>{p.vendor} · {p.runtime}</span>
          </span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" style={{ color: C.mute }}><X size={17} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-5">
          <p className="text-sm leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>{p.desc}</p>

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>Endpoint</div>
            <code className="block px-3 py-2 rounded-lg text-xs" style={{ background: C.panel, color: C.green, border: `1px solid ${C.borderSoft}`, fontFamily: "ui-monospace, Menlo, monospace" }}>
              {p.endpoint}
            </code>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>Tools ({p.tools.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {p.tools.map((t) => (
                <span key={t} className="px-2 py-1 rounded-md text-xs" style={{ background: C.panel, color: C.sub, border: `1px solid ${C.borderSoft}`, fontFamily: "ui-monospace, Menlo, monospace" }}>
                  <Wrench size={10} className="inline mr-1" style={{ color: C.mute }} />{t}
                </span>
              ))}
            </div>
          </div>

          {p.creds.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>Credentials · stored per user (customUserVars)</div>
              {p.creds.map((c) => (
                <div key={c.key} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
                  <KeyRound size={14} style={{ color: C.amber }} />
                  <span className="text-sm flex-1" style={{ color: C.text, fontFamily: sans }}>{c.label}</span>
                  <input type="password" defaultValue="••••••••••••" className="bg-transparent text-right text-sm outline-none w-32"
                    style={{ color: C.mute, fontFamily: sans }} />
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>Project access · hard isolation by default</div>
            {PROJECTS.map((pr) => (
              <div key={pr.id} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
                <FolderKanban size={14} style={{ color: C.purple }} />
                <span className="text-sm flex-1" style={{ color: C.text, fontFamily: sans }}>{pr.name}</span>
                <Toggle on={!!projEnabled[pr.id]} onClick={() => toggleProj(pr.id)} />
              </div>
            ))}
            <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: C.mute, fontFamily: sans }}>
              <ShieldCheck size={12} /> Tools are only injected into chats inside enabled projects. User and project IDs are passed to the server on every call.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <span className="text-xs flex items-center gap-1.5" style={{ color: C.mute, fontFamily: sans }}>
            <ShieldCheck size={13} style={{ color: C.green }} /> Vetted · SSRF allowlisted · audit logged
          </span>
          <button className="ml-auto px-4 py-2 rounded-lg text-sm font-medium" style={{ background: C.accent, color: "#fff", fontFamily: sans }}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginsView({ plugins, onInstall, openId, setOpenId, projEnabled, toggleProj }) {
  const open = plugins.find((p) => p.id === openId);
  const featured = plugins.filter((p) => p.featured);
  const rest = plugins.filter((p) => !p.featured);
  return (
    <div className="relative flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Plugins</h1>
        <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
          MCP connectors, curated for this workspace. Local servers launch from Atlas's bundled runtimes — nothing to install on the machine.
        </p>
      </div>
      <div className="px-7 flex items-center gap-2 pb-4">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 max-w-sm" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <Search size={14} style={{ color: C.mute }} />
          <input placeholder="Search connectors…" className="bg-transparent text-sm outline-none flex-1" style={{ color: C.text, fontFamily: sans }} />
        </div>
        {["All", "Installed", "stdio", "Remote"].map((f, i) => (
          <button key={f} className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: i === 0 ? C.raised : "transparent", color: i === 0 ? C.text : C.mute, border: `1px solid ${i === 0 ? C.border : "transparent"}`, fontFamily: sans }}>{f}</button>
        ))}
        <button className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}>
          <Plus size={13} /> Add custom server
        </button>
      </div>

      <div className="px-7 pb-8 overflow-y-auto">
        {featured.length > 0 ? (
          <>
            <div className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: C.accent, fontFamily: sans }}>Knowledge layer</div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {featured.map((p) => <PluginCard key={p.id} p={p} onOpen={setOpenId} onInstall={onInstall} />)}
              <div className="rounded-xl p-4 flex flex-col justify-center gap-1.5" style={{ border: `1px dashed ${C.border}` }}>
                <span className="text-sm font-medium flex items-center gap-2" style={{ color: C.sub, fontFamily: sans }}>
                  <Building2 size={15} style={{ color: C.mute }} /> Knowledge Core ingests Confluence + Jira
                </span>
                <span className="text-xs leading-relaxed" style={{ color: C.mute, fontFamily: sans }}>
                  Runs as a peer service on this machine. Install registers it against the bundled runtime and scopes its six org tools per project.
                </span>
              </div>
            </div>
          </>
        ) : null}
        <div className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: C.mute, fontFamily: sans }}>Directory</div>
        <div className="grid grid-cols-3 gap-3">
          {rest.map((p) => <PluginCard key={p.id} p={p} onOpen={setOpenId} onInstall={onInstall} />)}
        </div>
      </div>

      {open ? <PluginModal p={open} onClose={() => setOpenId(null)} projEnabled={projEnabled[open.id] || {}} toggleProj={(prId) => toggleProj(open.id, prId)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skills view                                                         */
/* ------------------------------------------------------------------ */
function SkillsView() {
  const [openId, setOpenId] = useState("pptx");
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Skills</h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: C.sub, fontFamily: sans }}>
          Playbooks the model loads on demand. Metadata stays in context (~100 tokens each); full instructions load only when the
          router matches a task. The model emits structured JSON — deterministic helpers do the rest.
        </p>
      </div>
      <div className="px-7 pb-8 overflow-y-auto flex flex-col gap-2">
        {SKILLS.map((s) => {
          const Icon = s.icon;
          const open = openId === s.id;
          return (
            <div key={s.id} className="rounded-xl transition-colors" style={{ background: C.panel, border: `1px solid ${open ? C.border : C.borderSoft}` }}>
              <button onClick={() => setOpenId(open ? null : s.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 34, height: 34, background: s.dim }}>
                  <Icon size={17} style={{ color: s.color }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>{s.name}</span>
                    <span className="text-xs" style={{ color: C.mute, fontFamily: "ui-monospace, Menlo, monospace" }}>{s.ext}</span>
                  </span>
                  <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>Triggers: {s.triggers}</span>
                </span>
                <span className="text-xs hidden md:block" style={{ color: C.mute, fontFamily: sans }}>{s.meta} / {s.full.toLocaleString()} tokens</span>
                <Badge color={C.green} dim={C.greenDim}>Enabled</Badge>
                <ChevronDown size={15} style={{ color: C.mute, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
              </button>
              {open ? (
                <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4" style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14 }}>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>Pattern</div>
                    <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>{s.note}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>Helper</div>
                    <code className="block px-2.5 py-1.5 rounded-md text-xs mb-2" style={{ background: C.bg, color: C.green, border: `1px solid ${C.borderSoft}`, fontFamily: "ui-monospace, Menlo, monospace" }}>{s.helper}</code>
                    <div className="text-xs" style={{ color: C.mute, fontFamily: sans }}>Tier: <span style={{ color: C.sub }}>{s.tier}</span></div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>Validation gates</div>
                    {s.validators.map((v) => (
                      <div key={v} className="flex items-center gap-1.5 py-0.5">
                        <CheckCircle2 size={12} style={{ color: C.green }} />
                        <span className="text-xs" style={{ color: C.sub, fontFamily: sans }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Projects view                                                       */
/* ------------------------------------------------------------------ */
function ProjectsView() {
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4 flex items-end gap-3">
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Projects</h1>
          <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
            Isolated workspaces — conversations, knowledge, memory, templates, and plugins never cross projects unless you opt in.
          </p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium" style={{ background: C.accent, color: "#fff", fontFamily: sans }}>
          <Plus size={14} /> New project
        </button>
      </div>
      <div className="px-7 pb-8 overflow-y-auto grid grid-cols-2 gap-3">
        {PROJECTS.map((p) => (
          <div key={p.id} className="rounded-xl p-4 flex flex-col gap-2.5 cursor-pointer transition-colors"
            style={{ background: C.panel, border: `1px solid ${C.border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: C.purpleDim }}>
                <FolderKanban size={17} style={{ color: C.purple }} />
              </span>
              <span className="text-sm font-medium flex-1" style={{ color: C.text, fontFamily: sans }}>{p.name}</span>
              {p.shared
                ? <Badge color={C.amber} dim={C.amberDim} icon={Globe}>Shared library</Badge>
                : <Badge color={C.green} dim={C.greenDim} icon={Lock}>Isolated</Badge>}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>{p.instructions}</p>
            <div className="flex items-center gap-3 text-xs pt-1" style={{ color: C.mute, fontFamily: sans, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 }}>
              <span>{p.chats} chats</span><span>{p.templates} templates</span><span>{p.plugins} plugins</span>
              <span className="ml-auto flex items-center gap-1"><Database size={11} /> own memory</span>
            </div>
          </div>
        ))}
        <div className="rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer" style={{ border: `1px dashed ${C.border}`, minHeight: 140 }}>
          <Plus size={18} style={{ color: C.mute }} />
          <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>Create a project to scope chats, memory, and plugins</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
export default function AtlasApp() {
  const [view, setView] = useState("chat");
  const [artifact, setArtifact] = useState(true);
  const [plugins, setPlugins] = useState(PLUGIN_SEED);
  const [openPlugin, setOpenPlugin] = useState(null);
  const [projEnabled, setProjEnabled] = useState({
    "knowledge-core": { p1: true },
    filesystem: { p1: true, p2: true, p3: true },
    "atlas-memory": { p1: true, p2: true, p3: true },
  });

  const install = (id) => {
    setPlugins((ps) => ps.map((p) => (p.id === id ? { ...p, status: "installed" } : p)));
    setOpenPlugin(id);
  };
  const toggleProj = (pluginId, projectId) =>
    setProjEnabled((s) => ({ ...s, [pluginId]: { ...(s[pluginId] || {}), [projectId]: !(s[pluginId] || {})[projectId] } }));

  return (
    <div className="flex w-full" style={{ height: "100vh", background: C.bg, overflow: "hidden" }}>
      <Sidebar view={view} setView={setView} />
      <div className="flex-1 flex min-w-0">
        {view === "chat" ? <ChatView onOpenArtifact={() => setArtifact(true)} /> : null}
        {view === "plugins" ? (
          <PluginsView plugins={plugins} onInstall={install} openId={openPlugin} setOpenId={setOpenPlugin}
            projEnabled={projEnabled} toggleProj={toggleProj} />
        ) : null}
        {view === "skills" ? <SkillsView /> : null}
        {view === "projects" ? <ProjectsView /> : null}
        {view === "chat" && artifact ? <ArtifactPanel onClose={() => setArtifact(false)} /> : null}
      </div>
    </div>
  );
}
