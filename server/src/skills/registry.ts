export interface SkillMeta {
  id: string;
  name: string;
  ext: string;
  icon: string;
  colorToken: string;
  triggers: string;
  metaTokens: number;
  fullTokens: number;
  helper: string;
  validators: string[];
  tier: string;
  note: string;
}

/**
 * Registry metadata — the ~100-token always-visible tier (PRD §5), display fields
 * per reference/atlas-v2-ui.jsx (8 rows; react+site merged visually). The 'site'
 * skill id stays seeded in skills_state for the Stage 3 router contract.
 */
export const SKILL_REGISTRY: SkillMeta[] = [
  {
    id: 'pptx',
    name: 'Presentations',
    ext: '.pptx',
    icon: 'presentation',
    colorToken: 'accent',
    triggers: 'presentation · slides · deck · QBR',
    metaTokens: 98,
    fullTokens: 4200,
    helper: 'build_pptx.py',
    validators: ['openxml-audit schema', 'python-pptx round-trip', 'placeholder grep', 'thumbnail grid (when soffice present)'],
    tier: '12B → Bedrock',
    note: 'Model emits slide JSON under constrained decoding; helper fills branded .potx placeholders.',
  },
  {
    id: 'docx',
    name: 'Documents',
    ext: '.docx',
    icon: 'file-text',
    colorToken: 'blue',
    triggers: 'document · report · letter · redline',
    metaTokens: 92,
    fullTokens: 3800,
    helper: 'build_docx.py',
    validators: ['openxml-audit schema', 'python-docx round-trip', 'markitdown Jinja grep'],
    tier: '12B → Bedrock',
    note: 'docxtpl Jinja templates or python-docx primitives; tracked-changes via OOXML edit.',
  },
  {
    id: 'xlsx',
    name: 'Spreadsheets',
    ext: '.xlsx',
    icon: 'file-spreadsheet',
    colorToken: 'green',
    triggers: 'spreadsheet · model · budget · forecast',
    metaTokens: 104,
    fullTokens: 4600,
    helper: 'build_xlsx.py',
    validators: ['openxml-audit schema', 'openpyxl round-trip', 'formula syntax check', 'soffice recalc #REF!/#DIV/0! (opportunistic)'],
    tier: '12B → Bedrock',
    note: 'Cell/formula/format JSON into openpyxl. Recalc degrades gracefully when soffice is absent.',
  },
  {
    id: 'pdf',
    name: 'PDF',
    ext: '.pdf',
    icon: 'book-open',
    colorToken: 'purple',
    triggers: 'pdf · form · fill · extract',
    metaTokens: 88,
    fullTokens: 3100,
    helper: 'build_pdf.py',
    validators: ['pdfplumber text grep', 'page-count assert'],
    tier: '12B',
    note: 'weasyprint default (pure-Python HTML→PDF); reportlab for programmatic layouts; pdfplumber extraction.',
  },
  {
    id: 'md',
    name: 'Markdown',
    ext: '.md',
    icon: 'file-code',
    colorToken: 'sub',
    triggers: 'notes · readme · spec',
    metaTokens: 60,
    fullTokens: 900,
    helper: 'static HTML via bundled marked.js',
    validators: ['render check'],
    tier: 'E4B / 12B',
    note: 'Emitted directly; rendered as a static-HTML artifact — no bundler involved.',
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    ext: '.mmd',
    icon: 'git-branch',
    colorToken: 'amber',
    triggers: 'flowchart · sequence · ERD',
    metaTokens: 72,
    fullTokens: 1800,
    helper: 'bundled mermaid.js (sandboxed iframe)',
    validators: ['parse check', 'render check'],
    tier: '12B',
    note: 'Diagram source validated by a local parse pass before render.',
  },
  {
    id: 'svg',
    name: 'SVG',
    ext: '.svg',
    icon: 'layers',
    colorToken: 'blue',
    triggers: 'icon · illustration · figure',
    metaTokens: 66,
    fullTokens: 1500,
    helper: 'resvg / sharp rasterization',
    validators: ['XML well-formed', 'viewBox assert'],
    tier: '12B',
    note: 'Rasterized locally when embedding into decks or PDFs.',
  },
  {
    id: 'react',
    name: 'React & preview sites',
    ext: '.jsx',
    icon: 'braces',
    colorToken: 'accent',
    triggers: 'component · app · landing page · preview site',
    metaTokens: 110,
    fullTokens: 4900,
    helper: 'esbuild-wasm local bundler (Web Worker)',
    validators: ['esbuild compile', 'CSP-locked iframe render', 'zero external network calls'],
    tier: '12B → Bedrock',
    note: 'Multi-file virtual FS, local importmap React, sandboxed iframe. Fully air-gapped.',
  },
];
