// `npm run publish-places`: check places.json, run tests and a build, show what changed, then
// (after you confirm) commit and push. GitHub Actions deploys the site from the push.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { validatePlaces, type Place } from '../src/places.ts';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function step(label: string, cmd: string, args: string[]) {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n${label} failed; nothing was published.`);
    process.exit(1);
  }
}

async function main() {
  const places = JSON.parse(readFileSync(new URL('../src/data/places.json', import.meta.url), 'utf8')) as Place[];
  const errors = validatePlaces(places);
  if (errors.length) {
    console.error('places.json has problems:\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  // Remove photo folders that no place uses anymore (deleted places).
  const used = new Set(places.map((p) => p.id));
  for (const dir of git('ls-files', '--others', '--cached', '--', 'public/photos').split('\n').filter(Boolean)) {
    const id = dir.split('/')[2];
    if (id && !used.has(id)) rmSync(new URL(`../public/photos/${id}`, import.meta.url), { recursive: true, force: true });
  }

  const changed = git('status', '--porcelain', '--', 'src/data/places.json', 'public/photos');
  if (!changed) {
    console.log('Nothing new to publish.');
    return;
  }

  let before: Place[] = [];
  try {
    before = JSON.parse(git('show', 'HEAD:src/data/places.json')) as Place[];
  } catch {
    // First publish.
  }
  const prev = new Map(before.map((p) => [p.id, p]));
  const now = new Map(places.map((p) => [p.id, p]));
  const added = places.filter((p) => !prev.has(p.id)).map((p) => p.name);
  const removed = before.filter((p) => !now.has(p.id)).map((p) => p.name);
  const edited = places.filter((p) => prev.has(p.id) && JSON.stringify(prev.get(p.id)) !== JSON.stringify(p)).map((p) => p.name);
  const summary = [
    added.length ? `added ${added.join(', ')}` : '',
    edited.length ? `edited ${edited.join(', ')}` : '',
    removed.length ? `removed ${removed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  console.log(`\nChanges: ${summary || 'photos only'}`);

  step('Tests', 'npx', ['vitest', 'run']);
  step('Build', 'npm', ['run', 'build']);

  const remote = git('remote');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n${remote ? 'Commit and push to GitHub' : 'Commit (no GitHub remote yet, so no push)'}? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Not published. Your changes are still saved locally.');
    return;
  }
  git('add', '--all', '--', 'src/data/places.json', 'public/photos');
  git('commit', '-m', `Update places: ${summary || 'photos'}`);
  if (remote) {
    step('Push', 'git', ['push']);
    console.log('\nPushed. The site updates in a minute or two.');
  } else {
    console.log('\nCommitted locally. Set up GitHub Pages to put it online.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
