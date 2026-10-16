import { mkdtemp, cp, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadInternshipExport } from './internship-export.mjs';
const root = process.cwd();
// Validate one artifact before modifying any published output.
const artifact = await loadInternshipExport();
const stage = await mkdtemp(join(root, '.litos-refresh-'));
const generated = ['README.md', 'lists', 'data'];
const replaced = [];
let preserveStage = false;
try {
  for (const path of ['scripts', 'README.template.md', 'lists', 'data']) await cp(join(root, path), join(stage, path), { recursive: true });
  const artifactPath = join(stage, 'export.json');
  await writeFile(artifactPath, JSON.stringify(artifact));
  for (const script of ['update', 'snapshot']) await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`scripts/${script}.mjs`], { cwd: stage, env: { ...process.env, LITOS_EXPORT_PATH: artifactPath }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} failed with ${code}`)));
  });
  await writeFile(join(stage, 'data/export-generation.json'), JSON.stringify({ generation: artifact.generation, as_of: artifact.as_of, total: artifact.total, grouped_total: artifact.grouped_total, totals: artifact.totals }, null, 2) + '\n');
  for (const path of generated) {
    const old = join(stage, `${path}.previous`);
    await rename(join(root, path), old);
    replaced.push({ path, old, installed: false });
    await rename(join(stage, path), join(root, path));
    replaced.at(-1).installed = true;
  }
  console.log(`Published local generation ${artifact.generation} captured ${artifact.as_of}; Git publication is a separate step.`);
} catch (error) {
  const rollbackErrors = [];
  for (const item of replaced.reverse()) {
    try {
      if (item.installed) await rm(join(root, item.path), { recursive: true, force: true });
      await rename(item.old, join(root, item.path));
    } catch (failure) { rollbackErrors.push(failure); }
  }
  if (rollbackErrors.length) {
    preserveStage = true;
    throw new AggregateError([error, ...rollbackErrors], `Rollback needs recovery from ${stage}`);
  }
  throw error;
} finally { if (!preserveStage) await rm(stage, { recursive: true, force: true }); }
