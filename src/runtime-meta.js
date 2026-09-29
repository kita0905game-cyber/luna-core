import { BUILD_META } from './build-meta.generated.js';

function textOrNull(value){
  return typeof value==='string'&&value.trim()?value.trim():null;
}

export function runtimeMetadata(env={}){
  const version=env?.CF_VERSION_METADATA??null;
  return {
    git:{
      commitSha:textOrNull(BUILD_META.commitSha),
      branch:textOrNull(BUILD_META.branch),
      buildUuid:textOrNull(BUILD_META.buildUuid),
      source:BUILD_META.source??'unknown'
    },
    cloudflare:{
      versionId:textOrNull(version?.id),
      versionTag:textOrNull(version?.tag),
      versionTimestamp:textOrNull(version?.timestamp)
    }
  };
}
