import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const n = parseInt(process.argv[2] || '5000', 10);

function row(i: number) {
  const user = `user_${i % 100}`;
  const region = ['us', 'eu', 'apac', 'latam', 'africa'][i % 5];
  const plan = ['free', 'pro', 'biz'][i % 3];
  const tags = ['a', 'b', 'c', 'd', 'e'].slice(0, (i % 5) + 1);
  const events = Array.from({ length: (i % 5) + 1 }, (_, k) => ({ t: k, v: (i * k) % 1000 }));
  return {
    id: i,
    uuid: randomUUID(),
    ok: true,
    ts: 1700000000000 + i,
    user,
    attrs: { region, plan },
    name: 'Aya',
    tags,
    nums: [1, 2, 3, 4],
    events,
  };
}

async function main() {
  await mkdir('data', { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(JSON.stringify(row(i)));
  await writeFile('data/large.ndjson', lines.join('\n'));
  await writeFile('data/large.json', `[${lines.join(',')}]`);
  // small confirmation on stdout
  console.log(`generated data/large.ndjson and data/large.json with ${n} rows`);
}

main();


