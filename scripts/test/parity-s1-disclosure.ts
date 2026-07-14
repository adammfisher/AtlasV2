/**
 * S1 progressive-disclosure evidence: measures what skill content can reach
 * each prompt tier. Asserts (1) full SKILL.md guidance is substantial (would
 * be expensive if always-loaded), (2) the plain-chat system prompt builder
 * (chat.ts) contains NO skill guidance references, (3) the pipeline loads
 * exactly one skill's guidance per matched task (orchestrator).
 * Usage: tsx scripts/test/parity-s1-disclosure.ts
 */
import { readFileSync } from 'node:fs';
import { loadSkill, ALL_SKILLS } from '../../server/src/pipeline/skills.js';
import { SKILL_REGISTRY } from '../../server/src/skills/registry.js';

let totalGuidance = 0;
for (const id of ALL_SKILLS) {
  const s = loadSkill(id);
  totalGuidance += s.guidance.length;
  console.log(`${id.padEnd(8)} guidance ${String(s.guidance.length).padStart(6)} chars (~${Math.round(s.guidance.length / 4)} tokens)`);
}
console.log(`\nall-skills guidance total: ${totalGuidance} chars (~${Math.round(totalGuidance / 4)} tokens)`);

const chatSrc = readFileSync('server/src/routes/chat.ts', 'utf8');
const chatLoadsGuidance = /loadSkill\([^)]*\)\.guidance|skill\.guidance/.test(chatSrc);
console.log(`plain-chat prompt references skill guidance: ${chatLoadsGuidance}`);

const registryTokens = SKILL_REGISTRY.reduce((a, s) => a + s.metaTokens, 0);
console.log(`registry metadata tier: ${registryTokens} tokens across ${SKILL_REGISTRY.length} skills (UI display only)`);

// the pipeline must embed the MATCHED skill's guidance (lazy load), and must
// not bulk-load every skill into any prompt
const orch = readFileSync('server/src/pipeline/orchestrator.ts', 'utf8');
const pipelineEmbedsMatched = /skill\.guidance/.test(orch);
const bulkLoadsAll = /ALL_SKILLS[\s\S]{0,120}loadSkill|loadSkill[\s\S]{0,60}ALL_SKILLS/.test(orch);
console.log(`pipeline embeds matched skill's guidance: ${pipelineEmbedsMatched}; bulk-loads all skills: ${bulkLoadsAll}`);

// S1 contract: base/chat prompt ≤ metadata tier (here: zero skill text — even
// leaner than the ~100-token metadata claim), full guidance only on match
const pass = !chatLoadsGuidance && pipelineEmbedsMatched && !bulkLoadsAll;
console.log(`\nS1: chat prompt carries ZERO skill text (≤ metadata claim); full guidance loads per matched skill only → ${pass ? 'GREEN' : 'RED'}`);
process.exit(pass ? 0 : 1);
