'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../lambda');
const stations = require('../lambda/stations.json');
const model = require('../skill-package/interactionModels/custom/en-US.json').interactionModel.languageModel;

test('voice model and station catalog contain the same unique station IDs', () => {
  const stationType = model.types.find((type) => type.name === 'STATION');
  assert.ok(stationType);
  const modelIds = stationType.values.map((value) => value.id);
  const catalogIds = stations.map((station) => station.id);
  assert.equal(new Set(modelIds).size, modelIds.length);
  assert.equal(new Set(catalogIds).size, catalogIds.length);
  assert.deepEqual([...modelIds].sort(), [...catalogIds].sort());
  const playIntent = model.intents.find((intent) => intent.name === 'PlayStationIntent');
  assert.ok(playIntent.slots.some((slot) => slot.name === 'station' && slot.type === 'STATION'));
  for (const name of ['AMAZON.PauseIntent', 'AMAZON.ResumeIntent', 'AMAZON.StopIntent']) {
    assert.ok(model.intents.some((intent) => intent.name === name), `Missing ${name}`);
  }
});

test('every spoken name in the voice model selects its intended stream', async () => {
  const values = model.types.find((type) => type.name === 'STATION').values;
  for (const value of values) {
    const station = stations.find((entry) => entry.id === value.id);
    for (const spoken of [value.name.value, ...(value.name.synonyms || [])]) {
      const result = await handler({
        version: '1.0',
        context: { System: { device: { supportedInterfaces: { AudioPlayer: {} } } } },
        request: {
          type: 'IntentRequest',
          intent: { name: 'PlayStationIntent', slots: { station: { value: spoken } } }
        }
      });
      const stream = result.response.directives?.[0]?.audioItem?.stream;
      assert.equal(stream?.token, `yle:${value.id}`, `Wrong station for ${spoken}`);
      assert.equal(stream?.url, station.url, `Wrong URL for ${spoken}`);
    }
  }
});
