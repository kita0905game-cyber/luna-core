import { BUILD_META } from './build-meta.generated.js';

function textOrNull(value){
  return typeof value==='string'&&value.trim()?value.trim():null;
}

export function runtimeMetadata(env={},buildMeta=BUILD_META){
  const version=env?.CF_VERSION_METADATA??null;
  return {
    git:{
      commitSha:textOrNull(buildMeta.commitSha),
      branch:textOrNull(buildMeta.branch),
      buildUuid:textOrNull(buildMeta.buildUuid),
      source:buildMeta.source??'unknown'
    },
    cloudflare:{
      versionId:textOrNull(version?.id),
      versionTag:textOrNull(version?.tag),
      versionTimestamp:textOrNull(version?.timestamp)
    }
  };
}
