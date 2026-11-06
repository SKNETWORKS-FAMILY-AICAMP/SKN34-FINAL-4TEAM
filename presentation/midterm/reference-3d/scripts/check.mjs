import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nodes,links,forkPolicy} from '../src/data.js';
const ids=new Set(nodes.map(n=>n.id));assert.equal(ids.size,nodes.length);
for(const link of links){assert(ids.has(link.source)&&ids.has(link.target));const source=fs.readFileSync(new URL('../public/evidence/'+link.evidence.file,import.meta.url),'utf8');assert(source.includes(link.evidence.quote),`Missing source quote: ${link.label}`);}
assert.equal(new Set(nodes.map(n=>n.type)).size,5);
for(const branch of forkPolicy.branches){assert.equal(branch.parent,'original');assert(forkPolicy.allowedEpisodes.includes(branch.episode));}
assert.equal(forkPolicy.branches.length,2);
console.log(`PASS: ${nodes.length} nodes, ${links.length} source-backed links, five types; two original-only permitted example forks.`);
