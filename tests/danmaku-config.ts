import assert from 'node:assert/strict'
import { Writer, areaPresetIndex, areaPresets, decodeWebView, displayArea, remoteParameters, updateDanmakuSettings } from '../src/api/protobuf'

function decode(config: Writer) {
  const bytes = new Writer().bytes(10, config.finish()).finish()
  const settings = decodeWebView(Uint8Array.from(bytes).buffer)
  assert.ok(settings)
  return settings
}

const legacy = decode(new Writer().bool(1, true).bool(4, false).bool(6, true).uint(12, 70))
assert.equal(legacy.area, 70)
assert.equal(areaPresets[areaPresetIndex(legacy)], 75)
assert.equal(legacy.showTop, false)
assert.equal(legacy.showBottom, true)

const reduced = decode(new Writer().bool(1, false).uint(12, 70).bool(24, true).uint(25, 25).uint(28, 2).float(11, 0))
assert.equal(reduced.area, 25)
assert.equal(displayArea(reduced), 10)
assert.equal(reduced.opacity, 0)
assert.equal(reduced.enabled, true)
assert.equal(reduced.showTop && reduced.showBottom, true)
const upload = remoteParameters(updateDanmakuSettings(reduced, { speed: 1.3 }))
assert.equal(upload.dm_switch_state, '2')
assert.equal(upload.dm_area_v2, '25')
assert.equal(upload.blocktop_bottom, 'true')
assert.equal(remoteParameters(updateDanmakuSettings(reduced, { enabled: false })).dm_switch_state, '3')
assert.equal(remoteParameters(updateDanmakuSettings(reduced, { area: 75 })).dm_switch_state, '1')
assert.equal(decode(new Writer().bool(1, true).uint(28, 3)).enabled, false)
assert.equal(displayArea(decode(new Writer().uint(12, 70).uint(28, 1))), 100)
