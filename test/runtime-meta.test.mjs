import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeMetadata } from '../src/runtime-meta.js';

test('runtime metadata joins git build identity with Cloudflare version identity',()=>{
  const result=runtimeMetadata({
    CF_VERSION_METADATA:{
      id:'cf-version-123',
      tag:'production',
      timestamp:'2026-09-29T07:00:00.000Z'
    }
  },{
    commitSha:'03978196067a2c1021ead5eca8cc85be8c1497da',
    branch:'main',
    buildUuid:'build-abc',
    source:'cloudflare-workers-builds'
  });

  assert.deepEqual(result,{
    git:{
      commitSha:'03978196067a2c1021ead5eca8cc85be8c1497da',
      branch:'main',
      buildUuid:'build-abc',
      source:'cloudflare-workers-builds'
    },
    cloudflare:{
      versionId:'cf-version-123',
      versionTag:'production',
      versionTimestamp:'2026-09-29T07:00:00.000Z'
    }
  });
});

test('runtime metadata stays safe when bindings are absent locally',()=>{
  const result=runtimeMetadata({},{
    commitSha:null,
    branch:null,
    buildUuid:null,
    source:'repository-default'
  });

  assert.equal(result.git.commitSha,null);
  assert.equal(result.git.source,'repository-default');
  assert.equal(result.cloudflare.versionId,null);
  assert.equal(result.cloudflare.versionTimestamp,null);
});
