export interface SkillMeta {
  id: string;
  name: string;
  ext: string;
  triggers: string;
  metaTokens: number;
  fullTokens: string;
  helper: string;
  checks: string[];
  tier: string;
  schema: string;
}

/**
 * Registry metadata — the ~100-token always-visible tier (PRD §5).
 * Stage 3 replaces `schema` with the real skills/<id>/schema.json contents.
 */
export const SKILL_REGISTRY: SkillMeta[] = [
  {
    id: 'pptx',
    name: 'Presentations',
    ext: '.pptx',
    triggers: 'deck · slides · presentation · QBR',
    metaTokens: 110,
    fullTokens: '4.2k',
    helper: 'build_pptx.py',
    checks: ['OOXML', 'Round-trip', 'Placeholder grep', 'Thumbnails †'],
    tier: '12B',
    schema:
      '{ "slides": [{ "layout": "title|bullets|two_col|chart", "heading": "...", "bullets": ["..."], "chart": { "kind": "line", "labels": [], "series": [] } }] }',
  },
  {
    id: 'docx',
    name: 'Documents',
    ext: '.docx',
    triggers: 'report · letter · contract · redline',
    metaTokens: 105,
    fullTokens: '3.8k',
    helper: 'build_docx.py',
    checks: ['OOXML', 'Round-trip', 'Jinja grep'],
    tier: '12B',
    schema: '{ "sections": [{ "heading": "...", "level": 1, "paragraphs": ["..."], "table": null }] }',
  },
  {
    id: 'xlsx',
    name: 'Spreadsheets',
    ext: '.xlsx',
    triggers: 'model · budget · forecast · tracker',
    metaTokens: 120,
    fullTokens: '4.6k',
    helper: 'build_xlsx.py',
    checks: ['OOXML', 'Formula syntax', 'Recalc †'],
    tier: '12B',
    schema:
      '{ "sheets": [{ "name": "...", "cells": [{ "ref": "B2", "value": 120, "formula": "=SUM(B2:B9)" }] }] }',
  },
  {
    id: 'pdf',
    name: 'PDF',
    ext: '.pdf',
    triggers: 'pdf · form · fill · export',
    metaTokens: 95,
    fullTokens: '3.1k',
    helper: 'build_pdf.py · weasyprint',
    checks: ['Text grep', 'Page count'],
    tier: '12B',
    schema: '{ "pages": [{ "blocks": [{ "kind": "heading|para|table", "text": "..." }] }] }',
  },
  {
    id: 'md',
    name: 'Markdown',
    ext: '.md',
    triggers: 'notes · readme · summary · doc',
    metaTokens: 60,
    fullTokens: '1.2k',
    helper: 'direct emit',
    checks: ['marked.js render'],
    tier: 'E4B',
    schema: 'direct text emit — no JSON intermediate',
  },
  {
    id: 'mermaid',
    name: 'Diagrams',
    ext: '.mermaid',
    triggers: 'flowchart · sequence · ERD · state',
    metaTokens: 90,
    fullTokens: '2.4k',
    helper: 'mermaid.js (bundled)',
    checks: ['Parse check'],
    tier: '12B',
    schema: 'mermaid source, parse-validated before render',
  },
  {
    id: 'svg',
    name: 'SVG graphics',
    ext: '.svg',
    triggers: 'icon · illustration · graphic',
    metaTokens: 85,
    fullTokens: '2.1k',
    helper: 'resvg rasterize',
    checks: ['XML parse', 'ViewBox'],
    tier: '12B',
    schema: 'raw SVG, XML-validated; resvg rasterizes for embedding',
  },
  {
    id: 'react',
    name: 'React artifacts',
    ext: '.jsx',
    triggers: 'component · app · widget · tool',
    metaTokens: 130,
    fullTokens: '4.9k',
    helper: 'esbuild-wasm (local)',
    checks: ['Bundle', 'CSP — no CDN'],
    tier: '12B',
    schema: '{ "files": { "/App.jsx": "...", "/styles.css": "..." }, "entry": "/App.jsx" }',
  },
  {
    id: 'site',
    name: 'Preview sites',
    ext: 'multi-file',
    triggers: 'landing page · site · prototype',
    metaTokens: 140,
    fullTokens: '4.8k',
    helper: 'esbuild-wasm · VFS',
    checks: ['Bundle', 'Offline check'],
    tier: '12B',
    schema: '{ "files": { "/index.html": "...", "/main.js": "...", "/styles.css": "..." } }',
  },
];
