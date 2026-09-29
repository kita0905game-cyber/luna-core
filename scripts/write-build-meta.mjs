import { writeFile } from 'node:fs/promises';

const clean=(value)=>typeof value==='string'&&value.trim()?value.trim():null;
const meta={
  commitSha:clean(process.env.WORKERS_CI_COMMIT_SHA),
  branch:clean(process.env.WORKERS_CI_BRANCH),
  buildUuid:clean(process.env.WORKERS_CI_BUILD_UUID),
  source:process.env.WORKERS_CI==='1'?'cloudflare-workers-builds':'local-wrangler'
};

const content=`export const BUILD_META=${JSON.stringify(meta,null,2)};\n`;
await writeFile(new URL('../src/build-meta.generated.js',import.meta.url),content,'utf8');
console.log('[luna-core] build metadata prepared',JSON.stringify({
  commitSha:meta.commitSha,
  branch:meta.branch,
  source:meta.source
}));
