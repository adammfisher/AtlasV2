CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT DEFAULT '',
  created_at INTEGER, settings TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  title TEXT DEFAULT 'New chat', created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT CHECK(role IN ('user','assistant')), kind TEXT DEFAULT 'text',
  payload TEXT NOT NULL,
  created_at INTEGER
);
-- kind is open TEXT: office/skill kinds plus 'product' (PRD Amendment 1 §A2)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL, kind TEXT NOT NULL, current_version INTEGER DEFAULT 1, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY, artifact_id TEXT REFERENCES artifacts(id),
  version INTEGER, file_path TEXT, meta TEXT, validation TEXT, payload TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS skills_state (skill_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS plugin_installs (
  id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, source TEXT DEFAULT 'directory',
  custom_config TEXT, status TEXT DEFAULT 'installed', enabled_projects TEXT DEFAULT '[]',
  credentials_ref TEXT, last_error TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
-- PRD Amendment 1 §A2 — product masters & projections (project-scoped through their artifact)
CREATE TABLE IF NOT EXISTS product_states (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  state TEXT CHECK(state IN ('proposed','endorsed','specified','built','operating')),
  note TEXT DEFAULT '', stamped_by TEXT, at_version INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS projections (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  kind TEXT CHECK(kind IN ('concept_md','concept_docx','brd_docx','gate_pptx',
                           'context_mermaid','prototype_react','bundle',
                           'confluence_page','jira_epics')),
  at_version INTEGER NOT NULL, output_ref TEXT, target_ref TEXT,
  status TEXT DEFAULT 'local' CHECK(status IN ('local','pushed','stale','error')),
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS mem_kv (project_id TEXT, key TEXT, value TEXT, PRIMARY KEY(project_id, key));
CREATE TABLE IF NOT EXISTS mem_graph_nodes (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, name TEXT, props TEXT);
CREATE TABLE IF NOT EXISTS mem_graph_edges (src TEXT, dst TEXT, project_id TEXT, rel TEXT, props TEXT);
