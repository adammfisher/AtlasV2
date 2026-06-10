import { useState, useEffect, useRef } from "react";
import {
  Plus, Settings, ChevronDown, ChevronRight, X, Check, ArrowUp,
  Paperclip, Folder, FolderOpen, FileText, Database, Terminal, Cpu, Cloud,
  Shield, Lock, Download, Layers, BookOpen, Brain,
  Server, Puzzle, Sparkles, MessageSquare, RefreshCw, KeyRound, GitBranch,
  Table, Presentation, Code, Box, Eye, AlertTriangle, Info, Globe,
  History, Network, PenTool, LayoutTemplate, Loader2
} from "lucide-react";

/* ── Atlas palette · modeled on Claude.ai dark ─────────────────────────── */
const C = {
  win: "#1b1a18", bg: "#262624", side: "#1f1e1c", raise: "#30302c",
  raise2: "#3a3934", border: "#3b3a35", borderSoft: "#33322d",
  text: "#ece9e2", dim: "#a39d92", faint: "#7a756c",
  accent: "#d97757", accentDim: "rgba(217,119,87,0.14)",
  green: "#85a87c", greenDim: "rgba(133,168,124,0.16)",
  amber: "#c9a36a", amberDim: "rgba(201,163,106,0.15)",
  blue: "#8fb0d1", red: "#c97c70",
};
const SERIF = "ui-serif, Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const ICONS = {
  pptx: Presentation, docx: FileText, xlsx: Table, pdf: FileText,
  mermaid: GitBranch, react: Code, site: LayoutTemplate, md: PenTool,
};

let UID = 100;
const uid = () => ++UID;

/* ── Seed data ─────────────────────────────────────────────────────────── */
const SEED_PROJECTS = [
  { id: "p1", name: "Lightspeed Atlas", instructions: "Core product build. Prefer the Meridian brand templates. Keep all output in outputs/meridian/.", chats: 12, templates: 3, memory: "18 MB" },
  { id: "p2", name: "Client Redline", instructions: "Confidential contract work. Tracked changes only — never accept changes silently.", chats: 5, templates: 2, memory: "6 MB" },
  { id: "p3", name: "Org Intel Dev", instructions: "atlas-org-intel build sessions. Mirror Atlas stack choices: better-sqlite3, sqlite-vec, nomic-embed.", chats: 8, templates: 0, memory: "11 MB" },
];

const SEED_PLUGINS = [
  { id: "filesystem", name: "Filesystem", vendor: "Atlas built-in", icon: FolderOpen, status: "connected", bundled: true, transport: "stdio",
    runtime: "runtimes/node/bin/node servers/filesystem/index.js",
    desc: "Read and write files inside project-bound folders, with explicit permission gates and a full audit log.",
    tools: [["fs_read", "Read a file inside a bound folder"], ["fs_write", "Write or create a file (permission-gated)"], ["fs_list", "List a directory tree"], ["fs_search", "Search file contents within the binding"]],
    auth: "none", enabledIn: ["p1", "p2"] },
  { id: "memory", name: "Memory & Graph", vendor: "Atlas built-in", icon: Brain, status: "connected", bundled: true, transport: "stdio",
    runtime: "runtimes/node/bin/node servers/memory/index.js",
    desc: "Semantic recall and knowledge-graph traversal over the on-device memory store, partitioned per project.",
    tools: [["memory_search", "Hybrid semantic + lexical recall (sqlite-vec / FTS5)"], ["memory_upsert", "Write an asserted fact or preference"], ["graph_query", "Traverse entities and relationships"], ["graph_add_fact", "Add an entity or edge to the project graph"]],
    auth: "none", enabledIn: ["p1", "p2", "p3"] },
  { id: "sqlite", name: "SQLite Query", vendor: "Atlas built-in", icon: Database, status: "connected", bundled: true, transport: "stdio",
    runtime: "runtimes/python/bin/python -m atlas_mcp.sqlite",
    desc: "Query local SQLite databases read-only from chat. Useful for inspecting project data files and exports.",
    tools: [["sql_query", "Run a read-only query against a local .db file"], ["sql_schema", "Describe tables and indexes"]],
    auth: "none", enabledIn: ["p3"] },
  { id: "knowledge-core", name: "Knowledge Core", vendor: "atlas-org-intel", icon: Network, status: "planned", bundled: false, transport: "streamable-http",
    runtime: "http://127.0.0.1:7979/mcp",
    desc: "Org intelligence over Confluence and Jira — semantic search, entity graph, expert finding. Registers here when atlas-org-intel ships.",
    tools: [["org_search", "Semantic search across Confluence pages and Jira issues"], ["org_ask", "Grounded Q&A over the org corpus"], ["org_get_entity", "Fetch a person, project, or document entity"], ["org_traverse", "Walk the org graph from an entity"], ["org_find_experts", "Rank likely experts for a topic"], ["org_recent_activity", "Recent activity for a person or project"]],
    auth: "none", enabledIn: [] },
  { id: "github", name: "GitHub Enterprise", vendor: "Self-hosted", icon: GitBranch, status: "available", bundled: false, transport: "streamable-http",
    runtime: "https://github.internal.corp/mcp",
    desc: "Issues, pull requests, and code search against the on-prem GitHub Enterprise instance.",
    tools: [["gh_search_code", "Search code across allowed repos"], ["gh_get_pr", "Read a pull request with diff"], ["gh_list_issues", "List and filter issues"]],
    auth: "token", enabledIn: [] },
  { id: "jira", name: "Jira Data Center", vendor: "Atlassian DC", icon: Layers, status: "available", bundled: false, transport: "streamable-http",
    runtime: "https://jira.internal.corp/mcp",
    desc: "Direct Jira access — search, read, and transition issues. Superseded for analysis by Knowledge Core once it ships.",
    tools: [["jira_search", "JQL search"], ["jira_get_issue", "Read an issue with comments"], ["jira_transition", "Move an issue through workflow (gated)"]],
    auth: "token", enabledIn: [] },
  { id: "confluence", name: "Confluence Data Center", vendor: "Atlassian DC", icon: BookOpen, status: "available", bundled: false, transport: "streamable-http",
    runtime: "https://confluence.internal.corp/mcp",
    desc: "Read and search Confluence spaces directly from chat.",
    tools: [["conf_search", "CQL search across allowed spaces"], ["conf_get_page", "Read a page as markdown"]],
    auth: "token", enabledIn: [] },
  { id: "postgres", name: "PostgreSQL", vendor: "Community", icon: Server, status: "available", bundled: true, transport: "stdio",
    runtime: "runtimes/python/bin/python -m atlas_mcp.postgres",
    desc: "Read-only access to internal Postgres databases. Launched from the bundled Python runtime — nothing to install.",
    tools: [["pg_query", "Run a read-only query"], ["pg_schema", "Describe schemas and tables"]],
    auth: "connection", enabledIn: [] },
  { id: "sharepoint", name: "SharePoint Server", vendor: "Microsoft on-prem", icon: Globe, status: "available", bundled: false, transport: "streamable-http",
    runtime: "https://sp.internal.corp/mcp",
    desc: "Search and read documents from on-prem SharePoint site collections.",
    tools: [["sp_search", "Search documents and pages"], ["sp_get_doc", "Fetch a document for extraction"]],
    auth: "token", enabledIn: [] },
];

const SKILLS = [
  { id: "pptx", name: "Presentations", ext: ".pptx", triggers: "deck · slides · presentation · QBR", meta: 110, full: "4.2k",
    helper: "build_pptx.py", checks: ["OOXML", "Round-trip", "Placeholder grep", "Thumbnails †"], tier: "12B",
    schema: '{ "slides": [{ "layout": "title|bullets|two_col|chart", "heading": "...", "bullets": ["..."], "chart": { "kind": "line", "labels": [], "series": [] } }] }' },
  { id: "docx", name: "Documents", ext: ".docx", triggers: "report · letter · contract · redline", meta: 105, full: "3.8k",
    helper: "build_docx.py", checks: ["OOXML", "Round-trip", "Jinja grep"], tier: "12B",
    schema: '{ "sections": [{ "heading": "...", "level": 1, "paragraphs": ["..."], "table": null }] }' },
  { id: "xlsx", name: "Spreadsheets", ext: ".xlsx", triggers: "model · budget · forecast · tracker", meta: 120, full: "4.6k",
    helper: "build_xlsx.py", checks: ["OOXML", "Formula syntax", "Recalc †"], tier: "12B",
    schema: '{ "sheets": [{ "name": "...", "cells": [{ "ref": "B2", "value": 120, "formula": "=SUM(B2:B9)" }] }] }' },
  { id: "pdf", name: "PDF", ext: ".pdf", triggers: "pdf · form · fill · export", meta: 95, full: "3.1k",
    helper: "build_pdf.py · weasyprint", checks: ["Text grep", "Page count"], tier: "12B",
    schema: '{ "pages": [{ "blocks": [{ "kind": "heading|para|table", "text": "..." }] }] }' },
  { id: "md", name: "Markdown", ext: ".md", triggers: "notes · readme · summary · doc", meta: 60, full: "1.2k",
    helper: "direct emit", checks: ["marked.js render"], tier: "E4B",
    schema: "direct text emit — no JSON intermediate" },
  { id: "mermaid", name: "Diagrams", ext: ".mermaid", triggers: "flowchart · sequence · ERD · state", meta: 90, full: "2.4k",
    helper: "mermaid.js (bundled)", checks: ["Parse check"], tier: "12B",
    schema: "mermaid source, parse-validated before render" },
  { id: "svg", name: "SVG graphics", ext: ".svg", triggers: "icon · illustration · graphic", meta: 85, full: "2.1k",
    helper: "resvg rasterize", checks: ["XML parse", "ViewBox"], tier: "12B",
    schema: "raw SVG, XML-validated; resvg rasterizes for embedding" },
  { id: "react", name: "React artifacts", ext: ".jsx", triggers: "component · app · widget · tool", meta: 130, full: "4.9k",
    helper: "esbuild-wasm (local)", checks: ["Bundle", "CSP — no CDN"], tier: "12B",
    schema: '{ "files": { "/App.jsx": "...", "/styles.css": "..." }, "entry": "/App.jsx" }' },
  { id: "site", name: "Preview sites", ext: "multi-file", triggers: "landing page · site · prototype", meta: 140, full: "4.8k",
    helper: "esbuild-wasm · VFS", checks: ["Bundle", "Offline check"], tier: "12B",
    schema: '{ "files": { "/index.html": "...", "/main.js": "...", "/styles.css": "..." } }' },
];

const SEED_ARTIFACTS = [
  { id: 1, name: "Q3_QBR_Meridian.pptx", kind: "pptx", ver: 2, meta: "9 slides · 1.8 MB", project: "Lightspeed Atlas" },
  { id: 2, name: "MSA_section7_redline.docx", kind: "docx", ver: 4, meta: "Tracked changes · 22 pages", project: "Client Redline" },
  { id: 3, name: "pipeline_forecast.xlsx", kind: "xlsx", ver: 1, meta: "3 sheets · recalc pending", project: "Lightspeed Atlas" },
  { id: 4, name: "org-intel-landing", kind: "site", ver: 3, meta: "4 files · bundled offline", project: "Org Intel Dev" },
];

/* ── Pipeline templates per skill ──────────────────────────────────────── */
const PIPE = {
  pptx: {
    skillChip: "Presentations skill · 4.2k tokens", extraChip: "QBR_Master.potx",
    steps: ["slides JSON emitted — 8 slides, schema-valid first pass", "12 placeholders filled on QBR_Master.potx", "wrote outputs/meridian/Pipeline_Review.pptx"],
    checks: [["OOXML schema", 1], ["Round-trip", 1], ["Placeholders clean", 1], ["Recalc skipped — soffice not found", 0]],
    artifact: { name: "Pipeline_Review.pptx", kind: "pptx", meta: "8 slides · 1.4 MB" },
    text: "Drafted an eight-slide deck on the Meridian master — title, agenda, three content sections, a chart slide, and a summary. Charts are bound to placeholder series you can point at live data.",
  },
  docx: {
    skillChip: "Documents skill · 3.8k tokens", extraChip: "Meridian_Report.dotx",
    steps: ["sections JSON emitted — 6 sections, schema-valid", "docxtpl render against Meridian_Report.dotx", "wrote outputs/meridian/Draft_Report.docx"],
    checks: [["OOXML schema", 1], ["Round-trip", 1], ["Jinja tags clean", 1]],
    artifact: { name: "Draft_Report.docx", kind: "docx", meta: "6 sections · 11 pages" },
    text: "Drafted the document on the Meridian report template — six sections with styled headings, body copy, and a summary table. Styles inherit from the template, so brand fonts and spacing are already right.",
  },
  xlsx: {
    skillChip: "Spreadsheets skill · 4.6k tokens", extraChip: "openpyxl",
    steps: ["cells + formulas JSON emitted — 3 sheets", "openpyxl fill — 142 cells, 18 formulas", "wrote outputs/meridian/Draft_Model.xlsx"],
    checks: [["OOXML schema", 1], ["Formula syntax", 1], ["Recalc skipped — soffice not found", 0]],
    artifact: { name: "Draft_Model.xlsx", kind: "xlsx", meta: "3 sheets · 18 formulas" },
    text: "Built the workbook — inputs, calculations, and a summary sheet with formulas wired across all three. Formula syntax is validated; computed values will populate on first open since recalc isn't available on this machine.",
  },
  pdf: {
    skillChip: "PDF skill · 3.1k tokens", extraChip: "weasyprint",
    steps: ["blocks JSON emitted — 4 pages", "weasyprint render — pure-Python, no browser", "wrote outputs/meridian/Draft.pdf"],
    checks: [["Text grep", 1], ["Page count", 1]],
    artifact: { name: "Draft.pdf", kind: "pdf", meta: "4 pages · 96 KB" },
    text: "Rendered the PDF with weasyprint — four pages, styled headings, and a data table. Text-layer verified, so it's searchable and extraction-safe.",
  },
  mermaid: {
    skillChip: "Diagrams skill · 2.4k tokens", extraChip: "mermaid.js · bundled",
    steps: ["mermaid source emitted — parse-valid", "rendered with bundled mermaid.js — no CDN"],
    checks: [["Parse check", 1], ["Offline render", 1]],
    artifact: { name: "flow_diagram.mermaid", kind: "mermaid", meta: "flowchart · 6 nodes" },
    text: "Here's the flow. Rendered locally with the bundled mermaid build — happy to switch it to a sequence diagram or add a failure path.",
    diagram: true,
  },
  react: {
    skillChip: "Preview sites skill · 4.8k tokens", extraChip: "esbuild-wasm · local",
    steps: ["files emitted — 3-file project", "bundled with esbuild-wasm — 412 ms, cached", "served to sandboxed iframe · CSP locked"],
    checks: [["Bundle", 1], ["No external requests", 1]],
    artifact: { name: "preview-site", kind: "site", meta: "3 files · bundled offline" },
    text: "Built and bundled the preview entirely on-device — esbuild-wasm compiled it in under half a second and it's running in a locked sandbox. No CDN, no network.",
    preview: true,
  },
};
const EDIT_PIPE = {
  steps: ["one section regenerated — rest byte-identical"],
  checks: [["OOXML schema", 1], ["Targeted diff", 1]],
  text: "Made the change and regenerated only the affected section — everything else is byte-identical to the previous version, so review stays easy.",
};

function classify(t) {
  const s = t.toLowerCase();
  if (/(slide|deck|presentation|qbr|pptx)/.test(s)) return "pptx";
  if (/(redline|contract|letter|memo|report|docx|document)/.test(s)) return "docx";
  if (/(spreadsheet|forecast|budget|tracker|xlsx|workbook|sheet)/.test(s)) return "xlsx";
  if (/\bpdf\b/.test(s)) return "pdf";
  if (/(diagram|flowchart|sequence|architecture|erd)/.test(s)) return "mermaid";
  if (/(site|landing|page|prototype|dashboard|app|component|widget)/.test(s)) return "react";
  return "chat";
}
const isEdit = (t) => /(punchier|edit|change|update|tweak|revise|rewrite|fix|swap|make (slide|section|sheet))/i.test(t);

/* ── Seed conversation (the QBR demo) ──────────────────────────────────── */
const SEED_CONVS = [
  {
    id: "c1", title: "Q3 QBR deck from pipeline data",
    messages: [
      { id: 1, role: "user", text: "Build the Q3 QBR deck for Meridian from the pipeline numbers in /reports/q3 — use the client template." },
      { id: 2, role: "assistant", kind: "pipeline", stage: 3, skill: "pptx", modelChip: "Gemma 4 12B · constrained JSON",
        skillChip: "Presentations skill · 4.2k tokens", extraChip: "QBR_Master.potx",
        steps: ["slides JSON emitted — 9 slides, schema-valid first pass", "14 placeholders filled on QBR_Master.potx", "wrote outputs/meridian/Q3_QBR_Meridian.pptx"],
        checks: [["OOXML schema", 1], ["Round-trip", 1], ["Placeholders clean", 1], ["Recalc skipped — soffice not found", 0]],
        artifact: { name: "Q3_QBR_Meridian.pptx", kind: "pptx", meta: "9 slides · 1.8 MB", ver: 1 },
        text: "Built the Q3 QBR from pipeline_summary.xlsx — nine slides on the Meridian master, including the win-rate trend and the pipeline-by-stage waterfall." },
      { id: 3, role: "user", text: "Make slide 3 punchier and turn the win-rate table into a chart." },
      { id: 4, role: "assistant", kind: "pipeline", stage: 3, skill: "pptx", edit: true, modelChip: "Gemma 4 12B · constrained JSON",
        skillChip: "Targeted edit · slides[2] only",
        steps: ["slides[2] regenerated — rest byte-identical"],
        checks: [["OOXML schema", 1], ["Chart series bound", 1]],
        artifact: { name: "Q3_QBR_Meridian.pptx", kind: "pptx", meta: "9 slides · 1.8 MB", ver: 2 },
        text: "Rewrote the headline to lead with the number — “Win rate up 9 points in two quarters” — and swapped the table for a line chart bound to the same series. Only slide 3 was regenerated; the rest of the deck is byte-identical to v1." },
    ],
  },
  { id: "c2", title: "Schema alignment — AOI parser", messages: [] },
  { id: "c3", title: "Template Library: Meridian potx audit", messages: [] },
  { id: "c4", title: "xlsx recalc fallback design", messages: [] },
  { id: "c5", title: "Org-intel phase 2 handoff", messages: [] },
];

/* ── Atoms ─────────────────────────────────────────────────────────────── */
const Dot = ({ color }) => <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: color }} />;

function Toggle({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="relative rounded-full transition-colors flex-shrink-0"
      style={{ width: 34, height: 20, background: on ? C.accent : C.raise2, opacity: disabled ? 0.4 : 1, border: `1px solid ${on ? C.accent : C.border}` }}>
      <span className="absolute top-0.5 rounded-full transition-all"
        style={{ width: 14, height: 14, left: on ? 17 : 2, background: on ? "#fff" : C.dim }} />
    </button>
  );
}

function StatusBadge({ status }) {
  if (status === "connected") return <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: C.greenDim, color: C.green }}><Dot color={C.green} />Connected</span>;
  if (status === "installing") return <span className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap" style={{ background: C.raise, color: C.dim }}><Loader2 size={10} className="animate-spin" />Installing</span>;
  if (status === "planned") return <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: C.amberDim, color: C.amber }}><Dot color={C.amber} />Planned</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: C.raise, color: C.dim }}>Available</span>;
}

function Chip({ icon: Icon, children, tone, spin }) {
  const tones = {
    green: { bg: C.greenDim, fg: C.green }, amber: { bg: C.amberDim, fg: C.amber },
    accent: { bg: C.accentDim, fg: C.accent }, dim: { bg: C.raise, fg: C.dim },
  };
  const t = tones[tone] || tones.dim;
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md mr-1.5 mb-1.5" style={{ background: t.bg, color: t.fg }}>
      {Icon && <Icon size={11} className={spin ? "animate-spin" : ""} />}{children}
    </span>
  );
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */
function Sidebar({ view, setView, convs, activeConv, openConv, newChat, modelLabel }) {
  const nav = [
    { id: "projects", label: "Projects", icon: Folder },
    { id: "artifacts", label: "Artifacts", icon: Box },
    { id: "plugins", label: "Plugins", icon: Puzzle },
    { id: "skills", label: "Skills", icon: Sparkles },
  ];
  return (
    <div className="w-64 flex flex-col h-full flex-shrink-0" style={{ background: C.side, borderRight: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-semibold"
          style={{ background: `linear-gradient(135deg, ${C.accent}, #b85c3e)`, color: "#fff" }}>A</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold" style={{ color: C.text }}>Atlas</div>
          <div className="text-xs" style={{ color: C.faint }}>Local · on-device</div>
        </div>
      </div>

      <div className="px-2 space-y-0.5">
        <button onClick={newChat}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left"
          style={{ color: C.text }}>
          <Plus size={15} style={{ color: C.accent }} /> New chat
        </button>
        {nav.map((n) => {
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors"
              style={{ color: active ? C.text : C.dim, background: active ? C.raise : "transparent" }}>
              <n.icon size={15} style={{ color: active ? C.accent : C.faint }} />{n.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 mt-5 mb-1 text-xs font-medium" style={{ color: C.faint }}>Recents</div>
      <div className="px-2 overflow-y-auto flex-1 space-y-0.5">
        {convs.map((c) => {
          const active = view === "chat" && c.id === activeConv;
          return (
            <button key={c.id} onClick={() => openConv(c.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm truncate transition-colors"
              style={{ color: active ? C.text : C.dim, background: active ? C.raise : "transparent" }}>
              {c.title}
            </button>
          );
        })}
      </div>

      <div className="px-3 py-3 space-y-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="flex items-center gap-2 px-1.5 text-xs" style={{ color: C.dim }}>
          <Cpu size={13} style={{ color: C.green }} />
          {modelLabel}
          <span className="ml-auto" style={{ color: C.faint }}>24 GB</span>
        </div>
        <div className="flex items-center gap-2.5 px-1.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: C.raise2, color: C.text }}>AF</div>
          <div className="text-sm" style={{ color: C.text }}>Adam</div>
          <Settings size={14} className="ml-auto cursor-pointer" style={{ color: C.faint }} />
        </div>
      </div>
    </div>
  );
}

/* ── Chat pieces ───────────────────────────────────────────────────────── */
function ArtifactCard({ artifact, onOpen }) {
  const Icon = ICONS[artifact.kind] || FileText;
  return (
    <div onClick={onOpen}
      className="flex items-center gap-3 rounded-xl px-3.5 py-3 mt-3 cursor-pointer transition-colors"
      style={{ background: C.raise, border: `1px solid ${C.border}` }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: C.accentDim }}>
        <Icon size={17} style={{ color: C.accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate" style={{ color: C.text, fontFamily: MONO }}>{artifact.name}</div>
        <div className="text-xs" style={{ color: C.faint }}>{artifact.meta}</div>
      </div>
      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.raise2, color: C.dim }}>v{artifact.ver}</span>
      <Eye size={15} style={{ color: C.dim }} />
      <Download size={15} style={{ color: C.dim }} />
      <History size={15} style={{ color: C.dim }} />
    </div>
  );
}

function MermaidPreview() {
  const Node = ({ label }) => (
    <div className="px-3 py-2 rounded-lg text-xs whitespace-nowrap" style={{ background: C.raise2, color: C.text, border: `1px solid ${C.border}` }}>{label}</div>
  );
  const Arrow = () => <span style={{ color: C.faint }}>→</span>;
  return (
    <div className="mt-3 rounded-xl px-4 py-4 flex items-center gap-2.5 flex-wrap" style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
      <Node label="Ingest" /><Arrow /><Node label="Embed · sqlite-vec" /><Arrow /><Node label="Graph store" /><Arrow /><Node label="MCP tools" />
    </div>
  );
}

function SitePreview() {
  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: C.raise }}>
        <span className="w-2 h-2 rounded-full" style={{ background: C.red }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
        <span className="text-xs ml-2" style={{ color: C.faint, fontFamily: MONO }}>sandbox · csp locked · offline</span>
      </div>
      <div className="px-5 py-5" style={{ background: "#211f1d" }}>
        <div className="h-3 w-32 rounded" style={{ background: C.accent, opacity: 0.85 }} />
        <div className="h-2 w-64 max-w-full rounded mt-3" style={{ background: C.raise2 }} />
        <div className="h-2 w-52 max-w-full rounded mt-1.5" style={{ background: C.raise2 }} />
        <div className="flex gap-2 mt-4">
          <div className="h-7 w-20 rounded-lg" style={{ background: C.accentDim, border: `1px solid ${C.accent}` }} />
          <div className="h-7 w-20 rounded-lg" style={{ background: C.raise2 }} />
        </div>
      </div>
    </div>
  );
}

function PipelineMessage({ m, onOpenArtifact }) {
  return (
    <div>
      <div className="flex flex-wrap mb-2">
        {m.stage >= 1 && <Chip icon={m.edit ? RefreshCw : Sparkles} tone="accent">{m.skillChip}</Chip>}
        {m.stage >= 1 && m.extraChip && <Chip icon={LayoutTemplate} tone="dim">{m.extraChip}</Chip>}
        {m.stage >= 1 && <Chip icon={Cpu} tone="dim">{m.modelChip}</Chip>}
        {m.escalated && m.stage >= 1 && <Chip icon={ArrowUp} tone="amber">Escalated to 12B — office JSON</Chip>}
      </div>
      {m.stage === 0 && (
        <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
          <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
          Routing — E2B classifying the task…
        </div>
      )}
      {m.stage >= 2 && (
        <p className="text-base leading-relaxed" style={{ color: C.text, fontFamily: SERIF }}>{m.text}</p>
      )}
      {m.stage === 1 && (
        <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
          <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
          Generating constrained JSON…
        </div>
      )}
      {m.stage >= 2 && (
        <div className="mt-3 rounded-xl px-3.5 py-2.5" style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
          {m.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs py-0.5" style={{ color: C.dim, fontFamily: MONO }}>
              <Check size={12} className="mt-0.5 flex-shrink-0" style={{ color: C.green }} />
              <span>{s}</span>
            </div>
          ))}
          {m.stage === 2 && (
            <div className="flex items-center gap-2 text-xs py-0.5" style={{ color: C.dim, fontFamily: MONO }}>
              <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: C.accent }} />
              <span>validating…</span>
            </div>
          )}
        </div>
      )}
      {m.stage >= 3 && (
        <>
          <div className="flex flex-wrap mt-3">
            {m.checks.map(([t, ok]) => (
              <Chip key={t} icon={ok ? Check : AlertTriangle} tone={ok ? "green" : "amber"}>{t}</Chip>
            ))}
          </div>
          {m.diagram && <MermaidPreview />}
          {m.preview && <SitePreview />}
          {m.artifact && <ArtifactCard artifact={m.artifact} onOpen={onOpenArtifact} />}
        </>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  "Build a QBR deck from the Q3 pipeline numbers",
  "Redline section 7 of the Meridian MSA",
  "Forecast model for next quarter's pipeline",
  "Diagram the org-intel ingest flow",
  "Landing page prototype for Atlas",
];

function ChatView({ conv, onSend, busy, model, setModel, bedrock, openBedrock, onOpenArtifact, activeProjectName }) {
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv.messages]);

  const send = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    onSend(t);
  };

  const empty = conv.messages.length === 0;

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <span className="text-sm flex-shrink-0" style={{ color: C.dim }}>{activeProjectName}</span>
        <ChevronRight size={14} className="flex-shrink-0" style={{ color: C.faint }} />
        <span className="text-sm truncate" style={{ color: C.text }}>{conv.title}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: C.greenDim, color: C.green }}>
          <Lock size={11} /> Local — nothing leaves this machine
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="text-2xl mb-1" style={{ color: C.text, fontFamily: SERIF }}>What are we building, Adam?</div>
            <div className="text-sm mb-6" style={{ color: C.faint }}>Documents, decks, models, diagrams, and prototypes — all on this machine.</div>
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setInput(s)}
                  className="text-xs px-3 py-2 rounded-full transition-colors"
                  style={{ background: C.raise, color: C.dim, border: `1px solid ${C.borderSoft}` }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
            {conv.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="rounded-2xl px-4 py-3 text-sm max-w-md" style={{ background: C.raise, color: C.text }}>{m.text}</div>
                </div>
              ) : m.kind === "pipeline" ? (
                <PipelineMessage key={m.id} m={m} onOpenArtifact={() => onOpenArtifact(m.artifact)} />
              ) : (
                <div key={m.id}>
                  {m.pending ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
                      <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />Thinking…
                    </div>
                  ) : (
                    <p className="text-base leading-relaxed" style={{ color: C.text, fontFamily: SERIF }}>{m.text}</p>
                  )}
                </div>
              )
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-2xl mx-auto relative">
          {menuOpen && (
            <ModelMenu model={model} setModel={setModel} bedrock={bedrock} openBedrock={openBedrock} close={() => setMenuOpen(false)} />
          )}
          <div className="rounded-2xl px-4 pt-3 pb-2.5" style={{ background: C.raise, border: `1px solid ${C.border}` }}>
            <textarea
              rows={1} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message Atlas…"
              className="w-full bg-transparent outline-none resize-none text-sm"
              style={{ color: C.text }}
            />
            <div className="flex items-center gap-2 mt-2">
              <Plus size={17} style={{ color: C.dim }} className="cursor-pointer" />
              <Paperclip size={15} style={{ color: C.dim }} className="cursor-pointer" />
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ color: C.dim, background: C.bg }}>
                {model === "bedrock" ? <Cloud size={12} style={{ color: C.blue }} /> : <Cpu size={12} style={{ color: C.green }} />}
                {model === "bedrock" ? "Claude · Bedrock" : model === "e4b" ? "Gemma 4 E4B" : "Gemma 4 12B"}
                <ChevronDown size={12} />
              </button>
              <button onClick={send} disabled={busy}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: C.accent, opacity: busy ? 0.5 : 1 }}>
                {busy ? <Loader2 size={15} color="#fff" className="animate-spin" /> : <ArrowUp size={16} color="#fff" />}
              </button>
            </div>
          </div>
          <div className="text-center text-xs mt-2" style={{ color: C.faint }}>
            Atlas runs entirely on this machine. Generated documents are validated before delivery.
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelMenu({ model, setModel, bedrock, openBedrock, close }) {
  const Row = ({ id, name, sub, size, badge, lockNote, selectable = true }) => {
    const active = model === id;
    return (
      <div onClick={() => { if (selectable) { setModel(id); close(); } }}
        className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
        style={{ background: active ? C.raise2 : "transparent", cursor: selectable ? "pointer" : "default", opacity: selectable ? 1 : 0.75 }}>
        <Cpu size={14} style={{ color: active ? C.accent : C.faint }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm flex items-center gap-2" style={{ color: C.text }}>
            {name}
            {badge && <span className="text-xs px-1.5 rounded" style={{ background: C.greenDim, color: C.green }}>{badge}</span>}
          </div>
          <div className="text-xs" style={{ color: C.faint }}>{sub}</div>
        </div>
        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>{size}</span>
        {active && <Check size={14} style={{ color: C.accent }} />}
        {lockNote && <Lock size={12} style={{ color: C.faint }} />}
      </div>
    );
  };
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 rounded-xl p-2 z-10 shadow-2xl"
      style={{ background: C.side, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between px-3 pt-1 pb-2">
        <span className="text-xs font-medium" style={{ color: C.faint }}>ON-DEVICE</span>
        <X size={13} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
      </div>
      <Row id="e2b" name="Gemma 4 E2B" sub="Router · classification · always resident" size="3.0 GB" badge="router" lockNote selectable={false} />
      <Row id="e4b" name="Gemma 4 E4B" sub="Fast chat · summaries · low-RAM default" size="5.1 GB" />
      <Row id="12b" name="Gemma 4 12B" sub="Drafting · office JSON · code · diagrams" size="7.4 GB" />
      <div className="px-3 pt-3 pb-2 text-xs font-medium" style={{ color: C.faint }}>CLOUD UPGRADE</div>
      {bedrock ? (
        <div onClick={() => { setModel("bedrock"); close(); }}
          className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer"
          style={{ background: model === "bedrock" ? C.raise2 : "transparent" }}>
          <Cloud size={14} style={{ color: C.blue }} />
          <div className="flex-1">
            <div className="text-sm" style={{ color: C.text }}>Claude via Bedrock</div>
            <div className="text-xs" style={{ color: C.faint }}>Connected · us-east-1 · structured output</div>
          </div>
          {model === "bedrock" && <Check size={14} style={{ color: C.accent }} />}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <Cloud size={14} style={{ color: C.blue }} />
          <div className="flex-1">
            <div className="text-sm" style={{ color: C.text }}>Claude via Bedrock</div>
            <div className="text-xs" style={{ color: C.faint }}>Routes office JSON + code tasks when connected</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); close(); openBedrock(); }}
            className="text-xs px-2.5 py-1 rounded-lg" style={{ border: `1px solid ${C.accent}`, color: C.accent }}>
            Add model
          </button>
        </div>
      )}
      <div className="px-3 py-2 mt-1 text-xs rounded-lg" style={{ background: C.bg, color: C.faint }}>
        This machine: 24 GB unified · 12B Q4_K_XL resident · 32k context window
      </div>
    </div>
  );
}

function BedrockModal({ close, connect }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="w-full max-w-md rounded-2xl p-5 mx-4" style={{ background: C.side, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-medium flex items-center gap-2" style={{ color: C.text }}>
            <Cloud size={16} style={{ color: C.blue }} /> Connect Amazon Bedrock
          </div>
          <X size={16} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
        </div>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: C.dim }}>
          Adds Claude as a quality upgrade. Office JSON and code tasks route to it automatically; chat stays on-device unless you pick it.
        </p>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>REGION</div>
        <input defaultValue="us-east-1" className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }} />
        <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>CREDENTIAL PROFILE</div>
        <input defaultValue="corp-bedrock" className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }} />
        <div className="mt-2 text-xs" style={{ color: C.faint }}>Credentials resolve from the AWS provider chain. Nothing is stored by Atlas.</div>
        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={close} className="text-sm px-3.5 py-2 rounded-lg" style={{ color: C.dim, border: `1px solid ${C.border}` }}>Cancel</button>
          <button onClick={() => { setBusy(true); setTimeout(() => { connect(); }, 900); }}
            className="text-sm px-3.5 py-2 rounded-lg font-medium inline-flex items-center gap-2" style={{ background: C.accent, color: "#fff" }}>
            {busy && <Loader2 size={13} className="animate-spin" />}{busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Plugins ───────────────────────────────────────────────────────────── */
function PluginCard({ p, selected, onSelect, onToggle, activeProject }) {
  const planned = p.status === "planned";
  const enabledHere = p.enabledIn.includes(activeProject);
  return (
    <div onClick={onSelect} role="button"
      className="text-left rounded-xl p-4 transition-colors w-full cursor-pointer"
      style={{
        background: selected ? C.raise : C.bg,
        border: planned ? `1px dashed ${C.amber}` : `1px solid ${selected ? C.border : C.borderSoft}`,
      }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: planned ? C.amberDim : C.raise2 }}>
          <p.icon size={17} style={{ color: planned ? C.amber : C.dim }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: C.text }}>{p.name}</span>
            <span className="ml-auto flex-shrink-0"><StatusBadge status={p.status} /></span>
          </div>
          <div className="text-xs" style={{ color: C.faint }}>{p.vendor}</div>
        </div>
      </div>
      <p className="text-xs mt-2.5 leading-relaxed" style={{ color: C.dim }}>{p.desc}</p>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
          style={{ background: C.raise2, color: C.dim, fontFamily: MONO }}>
          {p.transport === "stdio" ? <Terminal size={10} /> : <Globe size={10} />}
          {p.transport}{p.bundled && p.transport === "stdio" ? " · bundled" : ""}
        </span>
        <span className="text-xs" style={{ color: C.faint }}>{p.tools.length} tools</span>
        <span className="text-xs ml-auto" style={{ color: C.faint }}>
          {p.status === "connected" ? `${p.enabledIn.length} project${p.enabledIn.length === 1 ? "" : "s"}` : ""}
        </span>
        {p.status === "connected" && (
          <span onClick={(e) => e.stopPropagation()}>
            <Toggle on={enabledHere} onClick={onToggle} />
          </span>
        )}
      </div>
    </div>
  );
}

function PluginDetail({ p, projects, setEnabled, install, remove, restart, restarting, close }) {
  const planned = p.status === "planned";
  const authFields = {
    token: [["Personal access token", "ghp_••••••••••••"]],
    connection: [["Connection string", "postgres://reader:••••@db.internal:5432/sales"]],
    none: [],
  };
  return (
    <div className="w-96 flex-shrink-0 h-full overflow-y-auto px-5 py-5"
      style={{ background: C.side, borderLeft: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: planned ? C.amberDim : C.raise2 }}>
          <p.icon size={19} style={{ color: planned ? C.amber : C.dim }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium" style={{ color: C.text }}>{p.name}</div>
          <div className="text-xs" style={{ color: C.faint }}>{p.vendor}</div>
        </div>
        <X size={16} className="cursor-pointer mt-1" style={{ color: C.faint }} onClick={close} />
      </div>
      <div className="mt-3"><StatusBadge status={p.status} /></div>
      <p className="text-sm mt-3 leading-relaxed" style={{ color: C.dim }}>{p.desc}</p>

      {planned && (
        <div className="mt-4 rounded-xl px-3.5 py-3 text-xs leading-relaxed"
          style={{ background: C.amberDim, color: C.amber, border: `1px dashed ${C.amber}` }}>
          <Info size={12} className="inline mr-1.5 -mt-0.5" />
          Reserved connector. Registers automatically when atlas-org-intel ships. Tool result schemas must stay aligned with the AOI parser in chatService.js.
        </div>
      )}

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>CONNECTION</div>
      <div className="mt-2 rounded-lg px-3 py-2.5 text-xs break-all"
        style={{ background: C.bg, color: C.dim, fontFamily: MONO, border: `1px solid ${C.borderSoft}` }}>
        {p.runtime}
      </div>

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>TOOLS</div>
      <div className="mt-2 space-y-1.5">
        {p.tools.map(([name, desc]) => (
          <div key={name} className="rounded-lg px-3 py-2" style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
            <div className="text-xs" style={{ color: C.text, fontFamily: MONO }}>{name}</div>
            <div className="text-xs mt-0.5" style={{ color: C.faint }}>{desc}</div>
          </div>
        ))}
      </div>

      {authFields[p.auth].length > 0 && (
        <>
          <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>CREDENTIALS</div>
          {authFields[p.auth].map(([label, val]) => (
            <div key={label} className="mt-2 rounded-lg px-3 py-2.5 flex items-center gap-2"
              style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
              <KeyRound size={13} style={{ color: C.faint }} />
              <div className="min-w-0">
                <div className="text-xs" style={{ color: C.faint }}>{label}</div>
                <div className="text-xs truncate" style={{ color: C.dim, fontFamily: MONO }}>{val}</div>
              </div>
            </div>
          ))}
          <div className="text-xs mt-1.5" style={{ color: C.faint }}>Stored encrypted on this machine. Never synced.</div>
        </>
      )}

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>ENABLED IN PROJECTS</div>
      <div className="mt-2 space-y-1">
        {projects.map((proj) => {
          const on = p.enabledIn.includes(proj.id);
          return (
            <div key={proj.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
              <Folder size={13} style={{ color: C.faint }} />
              <span className="text-sm flex-1" style={{ color: C.text }}>{proj.name}</span>
              <Toggle on={on} disabled={p.status !== "connected"}
                onClick={() => setEnabled(proj.id, !on)} />
            </div>
          );
        })}
      </div>
      <div className="text-xs mt-1.5" style={{ color: C.faint }}>A project's chats only see that project's tools.</div>

      <div className="mt-6 flex gap-2">
        {p.status === "connected" && (
          <>
            <button onClick={restart}
              className="flex-1 text-xs py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
              style={{ border: `1px solid ${C.border}`, color: restarting ? C.green : C.dim }}>
              {restarting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {restarting ? "Restarting…" : "Restart"}
            </button>
            <button onClick={remove} className="flex-1 text-xs py-2 rounded-lg" style={{ border: `1px solid ${C.border}`, color: C.red }}>
              Remove
            </button>
          </>
        )}
        {p.status === "available" && (
          <button onClick={install} className="flex-1 text-sm py-2 rounded-lg font-medium" style={{ background: C.accent, color: "#fff" }}>
            Install
          </button>
        )}
        {p.status === "installing" && (
          <button disabled className="flex-1 text-sm py-2 rounded-lg inline-flex items-center justify-center gap-2"
            style={{ background: C.raise2, color: C.dim }}>
            <Loader2 size={13} className="animate-spin" /> Installing from bundled runtime…
          </button>
        )}
        {planned && (
          <button disabled className="flex-1 text-sm py-2 rounded-lg"
            style={{ border: `1px dashed ${C.amber}`, color: C.amber, opacity: 0.7 }}>
            Reserved — port 7979
          </button>
        )}
      </div>
    </div>
  );
}

function AddServerModal({ close, add }) {
  const [transport, setTransport] = useState("stdio");
  const [name, setName] = useState("");
  const [cmd, setCmd] = useState("");
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="w-full max-w-md rounded-2xl p-5 mx-4" style={{ background: C.side, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-medium" style={{ color: C.text }}>Add custom server</div>
          <X size={16} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
        </div>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>NAME</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Internal tooling"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}` }} />
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>TRANSPORT</div>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {["stdio", "streamable-http", "sse", "websocket"].map((t) => (
            <button key={t} onClick={() => setTransport(t)}
              className="text-xs px-2.5 py-1.5 rounded-lg"
              style={{
                background: transport === t ? C.accentDim : C.bg,
                color: transport === t ? C.accent : C.dim,
                border: `1px solid ${transport === t ? C.accent : C.borderSoft}`,
              }}>
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>{transport === "stdio" ? "COMMAND" : "URL"}</div>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)}
          placeholder={transport === "stdio" ? "runtimes/python/bin/python -m my_server" : "https://tool.internal.corp/mcp"}
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }} />
        {transport === "stdio" && (
          <div className="mt-1.5 text-xs" style={{ color: C.faint }}>
            Launched from the bundled runtimes — Node and Python ship inside the Atlas folder. Nothing to install.
          </div>
        )}
        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={close} className="text-sm px-3.5 py-2 rounded-lg" style={{ color: C.dim, border: `1px solid ${C.border}` }}>Cancel</button>
          <button
            onClick={() => { if (name.trim()) { add(name.trim(), transport, cmd.trim()); close(); } }}
            className="text-sm px-3.5 py-2 rounded-lg font-medium" style={{ background: C.accent, color: "#fff", opacity: name.trim() ? 1 : 0.5 }}>
            Install
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginsView({ plugins, setPlugins, projects, activeProject }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const counts = {
    all: plugins.length,
    connected: plugins.filter((p) => p.status === "connected").length,
    available: plugins.filter((p) => p.status === "available" || p.status === "installing").length,
    planned: plugins.filter((p) => p.status === "planned").length,
  };
  const shown = plugins.filter((p) => {
    if (filter === "all") return true;
    if (filter === "available") return p.status === "available" || p.status === "installing";
    return p.status === filter;
  });
  const sel = plugins.find((p) => p.id === selected);

  const patch = (id, fn) => setPlugins((ps) => ps.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)));

  const install = (id) => {
    patch(id, () => ({ status: "installing" }));
    setTimeout(() => patch(id, () => ({ status: "connected", enabledIn: [activeProject] })), 1100);
  };
  const remove = (id) => { patch(id, (p) => ({ status: p.bundled || p.id.startsWith("custom") ? "available" : "available", enabledIn: [] })); setSelected(null); };
  const restart = () => { setRestarting(true); setTimeout(() => setRestarting(false), 900); };
  const setEnabled = (id, projId, on) =>
    patch(id, (p) => ({ enabledIn: on ? [...p.enabledIn, projId] : p.enabledIn.filter((x) => x !== projId) }));
  const toggleHere = (id) =>
    patch(id, (p) => ({
      enabledIn: p.enabledIn.includes(activeProject)
        ? p.enabledIn.filter((x) => x !== activeProject)
        : [...p.enabledIn, activeProject],
    }));
  const addCustom = (name, transport, cmd) => {
    const id = "custom-" + uid();
    setPlugins((ps) => [...ps, {
      id, name, vendor: "Custom", icon: Terminal,
      status: "installing", bundled: transport === "stdio", transport,
      runtime: cmd || (transport === "stdio" ? "runtimes/python/bin/python -m my_server" : "https://tool.internal.corp/mcp"),
      desc: "Custom server added from the directory modal. Tool list loads on first connect.",
      tools: [["(discovering…)", "Tools are listed after the first successful connect"]],
      auth: "none", enabledIn: [],
    }]);
    setTimeout(() => setPlugins((ps) => ps.map((p) => (p.id === id ? { ...p, status: "connected", enabledIn: [activeProject] } : p))), 1100);
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-start gap-3">
            <div>
              <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>Plugins</h1>
              <p className="text-sm mt-1" style={{ color: C.dim }}>
                MCP connectors, curated for this machine. Local servers launch from the bundled runtimes — no installs, no admin.
              </p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="ml-auto flex-shrink-0 text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5 font-medium"
              style={{ background: C.accent, color: "#fff" }}>
              <Plus size={14} /> Add custom server
            </button>
          </div>

          <div className="flex items-center gap-1.5 mt-6 flex-wrap">
            {[["all", "All"], ["connected", "Connected"], ["available", "Available"], ["planned", "Planned"]].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{
                  background: filter === k ? C.raise2 : "transparent",
                  color: filter === k ? C.text : C.dim,
                  border: `1px solid ${filter === k ? C.border : "transparent"}`,
                }}>
                {label} <span style={{ color: C.faint }}>{counts[k]}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: C.faint }}>
              <Shield size={12} /> SSRF allowlist active
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
            {shown.map((p) => (
              <PluginCard key={p.id} p={p}
                selected={selected === p.id}
                onSelect={() => setSelected(p.id === selected ? null : p.id)}
                onToggle={() => toggleHere(p.id)}
                activeProject={activeProject}
              />
            ))}
          </div>
        </div>
      </div>
      {sel && (
        <PluginDetail
          p={sel} projects={projects}
          setEnabled={(projId, on) => setEnabled(sel.id, projId, on)}
          install={() => install(sel.id)}
          remove={() => remove(sel.id)}
          restart={restart} restarting={restarting}
          close={() => setSelected(null)}
        />
      )}
      {showAdd && <AddServerModal close={() => setShowAdd(false)} add={addCustom} />}
    </div>
  );
}

/* ── Skills ────────────────────────────────────────────────────────────── */
function SkillsView({ skillsOn, setSkillsOn }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>Skills</h1>
        <p className="text-sm mt-1 leading-relaxed" style={{ color: C.dim }}>
          Playbooks that drive the on-device models through document creation. Metadata (~100 tokens each) is always in
          context; the full playbook loads only when the router matches a task. The model emits structured JSON —
          deterministic helpers fill the templates.
        </p>

        <div className="mt-6 space-y-2">
          {SKILLS.map((s) => {
            const Icon = ICONS[s.id] || PenTool;
            const on = skillsOn[s.id];
            const expanded = open === s.id;
            return (
              <div key={s.id} className="rounded-xl transition-colors"
                style={{ background: expanded ? C.raise : C.bg, border: `1px solid ${expanded ? C.border : C.borderSoft}`, opacity: on ? 1 : 0.55 }}>
                <div className="px-4 py-3.5 flex items-center gap-4 cursor-pointer" onClick={() => setOpen(expanded ? null : s.id)}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: C.raise2 }}>
                    <Icon size={16} style={{ color: C.dim }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: C.text }}>{s.name}</span>
                      <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>{s.ext}</span>
                    </div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>{s.triggers}</div>
                  </div>
                  <div className="hidden md:block text-right flex-shrink-0">
                    <div className="text-xs" style={{ color: C.dim, fontFamily: MONO }}>{s.meta} / {s.full} tok</div>
                    <div className="text-xs mt-0.5" style={{ color: C.faint, fontFamily: MONO }}>{s.helper}</div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-md flex-shrink-0" style={{ background: C.accentDim, color: C.accent, fontFamily: MONO }}>{s.tier}</span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle on={on} onClick={() => setSkillsOn({ ...skillsOn, [s.id]: !on })} />
                  </span>
                </div>
                {expanded && (
                  <div className="px-4 pb-4" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>MODEL EMITS</div>
                    <div className="mt-1.5 rounded-lg px-3 py-2.5 text-xs break-all"
                      style={{ background: C.bg, color: C.dim, fontFamily: MONO, border: `1px solid ${C.borderSoft}` }}>
                      {s.schema}
                    </div>
                    <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>VALIDATION CHAIN</div>
                    <div className="flex flex-wrap mt-1.5">
                      {s.checks.map((c) => (
                        <Chip key={c} icon={Check} tone="green">{c}</Chip>
                      ))}
                    </div>
                    <div className="text-xs mt-1 leading-relaxed" style={{ color: C.faint }}>
                      Constrained decoding (json_schema → GBNF) guarantees syntax; the chain above gates delivery. Failures trigger
                      up to two repair retries, then tier escalation.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl px-4 py-3.5 text-xs leading-relaxed flex gap-2.5"
          style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, color: C.faint }}>
          <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: C.dim }} />
          <span>
            † Recalc and thumbnail checks run only when LibreOffice is present on this machine. When absent, validation degrades
            to OOXML schema, library round-trip, and placeholder checks — and the output is flagged accordingly.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Projects ──────────────────────────────────────────────────────────── */
function NewProjectModal({ close, create }) {
  const [name, setName] = useState("");
  const [inst, setInst] = useState("");
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="w-full max-w-md rounded-2xl p-5 mx-4" style={{ background: C.side, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-medium" style={{ color: C.text }}>New project</div>
          <X size={16} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
        </div>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>NAME</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 Planning"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}` }} />
        <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>INSTRUCTIONS</div>
        <textarea value={inst} onChange={(e) => setInst(e.target.value)} rows={3}
          placeholder="Persistent system prompt for every chat in this project…"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}` }} />
        <div className="text-xs mt-1" style={{ color: C.faint }}>
          Memory, files, templates, and plugins will be scoped to this project with hard isolation.
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={close} className="text-sm px-3.5 py-2 rounded-lg" style={{ color: C.dim, border: `1px solid ${C.border}` }}>Cancel</button>
          <button onClick={() => { if (name.trim()) { create(name.trim(), inst.trim()); close(); } }}
            className="text-sm px-3.5 py-2 rounded-lg font-medium" style={{ background: C.accent, color: "#fff", opacity: name.trim() ? 1 : 0.5 }}>
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectsView({ projects, setProjects, activeProject, setActiveProject }) {
  const [showNew, setShowNew] = useState(false);
  const create = (name, instructions) => {
    const id = "p" + uid();
    setProjects((ps) => [...ps, { id, name, instructions: instructions || "No instructions yet.", chats: 0, templates: 0, memory: "0 MB" }]);
    setActiveProject(id);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center">
          <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>Projects</h1>
          <button onClick={() => setShowNew(true)}
            className="ml-auto text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5 font-medium"
            style={{ background: C.accent, color: "#fff" }}>
            <Plus size={14} /> New project
          </button>
        </div>
        <p className="text-sm mt-1" style={{ color: C.dim }}>
          Each project scopes its own chats, files, memory, templates, and plugins. Nothing crosses between projects.
          Click a project to make it active.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          {projects.map((p) => {
            const active = p.id === activeProject;
            return (
              <div key={p.id} onClick={() => setActiveProject(p.id)} role="button"
                className="rounded-xl p-4 cursor-pointer transition-colors"
                style={{ background: active ? C.raise : C.bg, border: `1px solid ${active ? C.accent : C.borderSoft}` }}>
                <div className="flex items-center gap-2">
                  <Folder size={15} style={{ color: C.accent }} />
                  <span className="text-sm font-medium" style={{ color: C.text }}>{p.name}</span>
                  {active && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.accentDim, color: C.accent }}>Active</span>}
                  <span className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: C.raise2, color: C.dim }}>
                    <Lock size={10} /> Isolated
                  </span>
                </div>
                <p className="text-xs mt-2.5 leading-relaxed" style={{ color: C.dim }}>{p.instructions}</p>
                <div className="flex items-center gap-3 mt-3.5 text-xs" style={{ color: C.faint }}>
                  <span>{p.chats} chats</span>
                  <span>{p.templates} templates</span>
                  <span className="ml-auto" style={{ fontFamily: MONO }}>{p.memory} memory</span>
                </div>
              </div>
            );
          })}
          <div className="rounded-xl p-4 flex flex-col justify-center" style={{ border: `1px dashed ${C.border}` }}>
            <div className="flex items-center gap-2">
              <Layers size={15} style={{ color: C.dim }} />
              <span className="text-sm font-medium" style={{ color: C.dim }}>Shared library</span>
            </div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: C.faint }}>
              Opt-in global partition. Publish artifacts, templates, or facts here to reference them from any project.
            </p>
          </div>
        </div>
      </div>
      {showNew && <NewProjectModal close={() => setShowNew(false)} create={create} />}
    </div>
  );
}

/* ── Artifacts ─────────────────────────────────────────────────────────── */
function ArtifactDetail({ a, close }) {
  const Icon = ICONS[a.kind] || FileText;
  const versions = Array.from({ length: a.ver }, (_, i) => a.ver - i);
  return (
    <div className="w-96 flex-shrink-0 h-full overflow-y-auto px-5 py-5"
      style={{ background: C.side, borderLeft: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: C.accentDim }}>
          <Icon size={19} style={{ color: C.accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium break-all" style={{ color: C.text, fontFamily: MONO }}>{a.name}</div>
          <div className="text-xs mt-0.5" style={{ color: C.faint }}>{a.project} · {a.meta}</div>
        </div>
        <X size={16} className="cursor-pointer mt-1" style={{ color: C.faint }} onClick={close} />
      </div>

      <div className="mt-4 flex gap-2">
        <button className="flex-1 text-sm py-2 rounded-lg font-medium inline-flex items-center justify-center gap-1.5"
          style={{ background: C.accent, color: "#fff" }}>
          <Eye size={13} /> Open preview
        </button>
        <button className="flex-1 text-sm py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
          style={{ border: `1px solid ${C.border}`, color: C.dim }}>
          <Download size={13} /> Download
        </button>
      </div>

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>VALIDATION</div>
      <div className="flex flex-wrap mt-2">
        <Chip icon={Check} tone="green">Schema valid</Chip>
        <Chip icon={Check} tone="green">Round-trip</Chip>
        <Chip icon={Lock} tone="dim">Rendered offline</Chip>
      </div>

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>VERSION HISTORY</div>
      <div className="mt-2 space-y-1">
        {versions.map((v) => (
          <div key={v} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
            <History size={13} style={{ color: C.faint }} />
            <span className="text-sm" style={{ color: C.text }}>v{v}</span>
            <span className="text-xs" style={{ color: C.faint }}>
              {v === a.ver ? "current" : v === 1 ? "initial generation" : "targeted edit"}
            </span>
            <button className="ml-auto text-xs" style={{ color: C.dim }}>Restore</button>
          </div>
        ))}
      </div>
      <div className="text-xs mt-1.5" style={{ color: C.faint }}>
        Edits regenerate only the affected sections — earlier versions stay byte-exact for diffing.
      </div>
    </div>
  );
}

function ArtifactsView({ artifacts, selected, setSelected }) {
  const sel = artifacts.find((a) => a.id === selected);
  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>Artifacts</h1>
          <p className="text-sm mt-1" style={{ color: C.dim }}>
            Everything Atlas has produced, versioned per project. Rendering is fully offline — no CDN, ever.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
            {artifacts.map((a) => {
              const Icon = ICONS[a.kind] || FileText;
              const active = selected === a.id;
              return (
                <div key={a.id} onClick={() => setSelected(active ? null : a.id)} role="button"
                  className="rounded-xl p-4 cursor-pointer transition-colors"
                  style={{ background: active ? C.raise : C.bg, border: `1px solid ${active ? C.border : C.borderSoft}` }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: C.accentDim }}>
                      <Icon size={16} style={{ color: C.accent }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate" style={{ color: C.text, fontFamily: MONO }}>{a.name}</div>
                      <div className="text-xs" style={{ color: C.faint }}>{a.project}</div>
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.raise, color: C.dim }}>v{a.ver}</span>
                  </div>
                  <div className="text-xs mt-3" style={{ color: C.faint }}>{a.meta}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {sel && <ArtifactDetail a={sel} close={() => setSelected(null)} />}
    </div>
  );
}

/* ── App ───────────────────────────────────────────────────────────────── */
export default function AtlasApp() {
  const [view, setView] = useState("chat");
  const [projects, setProjects] = useState(SEED_PROJECTS);
  const [activeProject, setActiveProject] = useState("p1");
  const [plugins, setPlugins] = useState(SEED_PLUGINS);
  const [skillsOn, setSkillsOn] = useState(Object.fromEntries(SKILLS.map((s) => [s.id, true])));
  const [artifacts, setArtifacts] = useState(SEED_ARTIFACTS);
  const [selArtifact, setSelArtifact] = useState(null);
  const [model, setModel] = useState("12b");
  const [bedrock, setBedrock] = useState(false);
  const [showBedrock, setShowBedrock] = useState(false);
  const [convs, setConvs] = useState(SEED_CONVS);
  const [activeConv, setActiveConv] = useState("c1");
  const [busy, setBusy] = useState(false);

  const conv = convs.find((c) => c.id === activeConv) || convs[0];
  const projectName = (projects.find((p) => p.id === activeProject) || projects[0]).name;
  const modelLabel = model === "bedrock" ? "Claude via Bedrock" : model === "e4b" ? "Gemma 4 E4B · resident" : "Gemma 4 12B · resident";

  const patchConv = (convId, fn) => setConvs((cs) => cs.map((c) => (c.id === convId ? fn(c) : c)));
  const patchMsg = (convId, msgId, fn) =>
    patchConv(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...fn(m) } : m)) }));

  const newChat = () => {
    const id = "c" + uid();
    setConvs((cs) => [{ id, title: "New chat", messages: [] }, ...cs]);
    setActiveConv(id);
    setView("chat");
  };
  const openConv = (id) => { setActiveConv(id); setView("chat"); };

  const onOpenArtifact = (artifact) => {
    const found = artifacts.find((a) => a.name === artifact.name);
    setSelArtifact(found ? found.id : null);
    setView("artifacts");
  };

  const send = (text) => {
    const convId = activeConv;
    const userMsg = { id: uid(), role: "user", text };
    patchConv(convId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? (text.length > 42 ? text.slice(0, 42) + "…" : text) : c.title,
      messages: [...c.messages, userMsg],
    }));

    const skill = classify(text);
    setBusy(true);

    /* plain chat */
    if (skill === "chat") {
      const mid = uid();
      patchConv(convId, (c) => ({ ...c, messages: [...c.messages, { id: mid, role: "assistant", pending: true }] }));
      setTimeout(() => {
        patchMsg(convId, mid, () => ({
          pending: false,
          text: "Happy to help. I can draft decks, documents, spreadsheets, and PDFs from your templates, build diagrams and small app prototypes, or dig through project files and memory — all on this machine. What should we make?",
        }));
        setBusy(false);
      }, 1100);
      return;
    }

    /* skill disabled */
    if (!skillsOn[skill]) {
      const mid = uid();
      const sName = SKILLS.find((s) => s.id === skill)?.name || skill;
      patchConv(convId, (c) => ({ ...c, messages: [...c.messages, { id: mid, role: "assistant", pending: true }] }));
      setTimeout(() => {
        patchMsg(convId, mid, () => ({
          pending: false,
          text: `The ${sName} skill is turned off, so I can't generate that right now. Flip it back on in Skills and ask again — the router will pick it up immediately.`,
        }));
        setBusy(false);
      }, 900);
      return;
    }

    /* pipeline generation or targeted edit */
    const existing = [...conv.messages].reverse().find((m) => m.kind === "pipeline" && m.artifact && m.skill === skill);
    const editing = existing && isEdit(text);
    const base = PIPE[skill];
    const escalated = model === "e4b" && ["pptx", "docx", "xlsx", "pdf"].includes(skill);
    const modelChip = model === "bedrock"
      ? "Claude via Bedrock · structured output"
      : escalated || model === "12b" ? "Gemma 4 12B · constrained JSON" : "Gemma 4 E4B";

    const mid = uid();
    const msg = editing
      ? {
          id: mid, role: "assistant", kind: "pipeline", stage: 0, skill, edit: true, modelChip,
          skillChip: "Targeted edit · one section only",
          steps: EDIT_PIPE.steps, checks: EDIT_PIPE.checks, text: EDIT_PIPE.text,
          artifact: { ...existing.artifact, ver: existing.artifact.ver + 1 },
        }
      : {
          id: mid, role: "assistant", kind: "pipeline", stage: 0, skill, modelChip, escalated,
          skillChip: base.skillChip, extraChip: base.extraChip,
          steps: base.steps, checks: base.checks, text: base.text,
          diagram: base.diagram, preview: base.preview,
          artifact: { ...base.artifact, ver: 1 },
        };

    patchConv(convId, (c) => ({ ...c, messages: [...c.messages, msg] }));

    setTimeout(() => patchMsg(convId, mid, () => ({ stage: 1 })), 600);
    setTimeout(() => patchMsg(convId, mid, () => ({ stage: 2 })), 1500);
    setTimeout(() => {
      patchMsg(convId, mid, () => ({ stage: 3 }));
      setBusy(false);
      setArtifacts((as) => {
        const i = as.findIndex((a) => a.name === msg.artifact.name);
        if (i >= 0) {
          const next = [...as];
          next[i] = { ...next[i], ver: msg.artifact.ver, meta: msg.artifact.meta };
          return next;
        }
        return [{ id: uid(), name: msg.artifact.name, kind: skill, ver: msg.artifact.ver, meta: msg.artifact.meta, project: projectName }, ...as];
      });
    }, 2500);
  };

  return (
    <div className="h-screen w-full flex" style={{ background: C.win }}>
      <div className="flex w-full h-full" style={{ background: C.bg }}>
        <Sidebar view={view} setView={setView} convs={convs} activeConv={activeConv}
          openConv={openConv} newChat={newChat} modelLabel={modelLabel} />
        <div className="flex-1 min-w-0 h-full">
          {view === "chat" && (
            <ChatView conv={conv} onSend={send} busy={busy}
              model={model} setModel={setModel}
              bedrock={bedrock} openBedrock={() => setShowBedrock(true)}
              onOpenArtifact={onOpenArtifact}
              activeProjectName={projectName} />
          )}
          {view === "plugins" && (
            <PluginsView plugins={plugins} setPlugins={setPlugins} projects={projects} activeProject={activeProject} />
          )}
          {view === "skills" && <SkillsView skillsOn={skillsOn} setSkillsOn={setSkillsOn} />}
          {view === "projects" && (
            <ProjectsView projects={projects} setProjects={setProjects}
              activeProject={activeProject} setActiveProject={setActiveProject} />
          )}
          {view === "artifacts" && (
            <ArtifactsView artifacts={artifacts} selected={selArtifact} setSelected={setSelArtifact} />
          )}
        </div>
      </div>
      {showBedrock && (
        <BedrockModal close={() => setShowBedrock(false)}
          connect={() => { setBedrock(true); setModel("bedrock"); setShowBedrock(false); }} />
      )}
    </div>
  );
}
