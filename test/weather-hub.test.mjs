import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeatherHubPatch } from '../src/weather-updater.js';

test('weather Hub patch contains compact current state and 45 minute freshness',()=>{
  const observedAt='2026-09-29T03:10:00.000Z';
  const patch=buildWeatherHubPatch({
    location:{label:'大阪市',latitude:34.6937,longitude:135.5023,timeZone:'Asia/Tokyo'},
    current:{temperatureC:25,feelsLikeC:26,conditionCode:3,icon:'☁️',displayKind:'cloud',precipitationMm:0},
    today:{lowC:21,highC:28,rainChanceAmPct:30,rainChancePmPct:40}
  },{observedAt});

  assert.equal(patch.location.label,'大阪市');
  assert.equal(patch.current.temperatureC,25);
  assert.equal(patch.current.displayKind,'cloud');
  assert.equal(patch.current.observedAt,observedAt);
  assert.equal(patch.today.rainChancePmPct,40);
  assert.equal(patch.freshness.status,'fresh');
  assert.equal(patch.freshness.expiresAt,'2026-09-29T03:55:00.000Z');
});
