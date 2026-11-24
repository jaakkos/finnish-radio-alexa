'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../lambda');
const stations = require('../lambda/stations.json');

function event(type, requestFields = {}, contextFields = {}) {
  return {
    version: '1.0',
    context: {
      System: { device: { supportedInterfaces: { AudioPlayer: {} } } },
      ...contextFields
    },
    request: { type, ...requestFields }
  };
}

function intent(name, slot, contextFields = {}) {
  return event('IntentRequest', { intent: { name, slots: slot ? { station: slot } : {} } }, contextFields);
}

function playing(stationId, offset = 12345) {
  return { AudioPlayer: { token: `yle:${stationId}`, offsetInMilliseconds: offset, playerActivity: 'PLAYING' } };
}

function assertPlay(result, stationId, isCallback = false) {
  const station = stations.find((entry) => entry.id === stationId);
  assert.equal(result.version, '1.0');
  if (isCallback) {
    assert.deepEqual(Object.keys(result.response), ['directives'], 'controller callbacks must contain only directives');
  } else {
    assert.equal(result.response.shouldEndSession, true, 'playback must end the skill conversation');
  }
  assert.equal(result.response.directives.length, 1);
  const directive = result.response.directives[0];
  assert.equal(directive.type, 'AudioPlayer.Play');
  assert.equal(directive.playBehavior, 'REPLACE_ALL');
  assert.equal(directive.audioItem.stream.url, station.url);
  assert.equal(directive.audioItem.stream.token, `yle:${station.id}`);
  assert.equal(directive.audioItem.stream.offsetInMilliseconds, 0, 'live radio always starts at the live edge');
  assert.equal(new URL(directive.audioItem.stream.url).protocol, 'https:');
  assert.equal(new URL(directive.audioItem.stream.url).hostname, 'icecast.live.yle.fi');
  assert.equal(directive.audioItem.metadata, undefined, 'omit metadata rather than supply an incomplete object');
}

function assertPrompt(result) {
  assert.equal(result.response.shouldEndSession, false);
  assert.ok(result.response.outputSpeech.text);
  assert.ok(result.response.reprompt.outputSpeech.text);
  assert.equal(result.response.directives, undefined);
}

test('launch plays Radio Suomi through the fixed HTTPS stream', async () => {
  assertPlay(await handler(event('LaunchRequest')), 'suomi');
});

test('listing stations speaks every catalog name in catalog order and asks for a selection', async () => {
  const result = await handler(intent('ListStationsIntent'));
  assert.equal(result.version, '1.0');
  assert.equal(result.response.outputSpeech.type, 'PlainText');
  const text = result.response.outputSpeech.text;
  let position = 0;
  for (const station of stations) {
    const name = station.speech || station.label;
    const index = text.indexOf(name, position);
    assert.ok(index >= position, `Missing or out-of-order station: ${name}`);
    position = index + name.length;
  }
  assert.ok(text.endsWith('Which station would you like to play?'));
});

test('listing stations keeps listening with a short reprompt and never changes audio', async () => {
  for (const context of [{}, playing('one'), { System: { device: { supportedInterfaces: {} } } }]) {
    const result = await handler(intent('ListStationsIntent', undefined, context));
    assertPrompt(result);
    assert.deepEqual(result.response.reprompt.outputSpeech, {
      type: 'PlainText',
      text: 'Say the name of the station you would like to play.'
    });
  }
});

test('listing automatically includes an added station and falls back to its label without speech', async () => {
  const station = { id: 'test-station', label: 'Test Station', speech: 'Spoken Test Station' };
  stations.push(station);
  try {
    for (const speech of ['Spoken Test Station', undefined, '']) {
      station.speech = speech;
      const result = await handler(intent('ListStationsIntent'));
      assert.ok(result.response.outputSpeech.text.endsWith(
        `, ${speech || station.label}. Which station would you like to play?`
      ));
    }
  } finally {
    stations.pop();
  }
});

test('a station-name reply after listing starts the selected stream through PlayStationIntent', async () => {
  const listRequest = intent('ListStationsIntent', undefined, playing('suomi'));
  listRequest.session = { new: true, sessionId: 'test-list-session' };
  assertPrompt(await handler(listRequest));

  const selectionRequest = intent('PlayStationIntent', { value: 'radio one' }, playing('suomi'));
  selectionRequest.session = { ...listRequest.session, new: false };
  assertPlay(await handler(selectionRequest), 'one');
});

test('every station ID, label, and alias selects its own channel', async () => {
  for (const station of stations) {
    for (const name of [station.id, station.label, ...station.aliases]) {
      assertPlay(await handler(intent('PlayStationIntent', { value: name })), station.id);
    }
  }
  assertPlay(await handler(intent('PlayStationIntent', { value: '  YLE---SÁMI  RADIO ' })), 'sami');
});

test('Alexa entity-resolution IDs take precedence over imperfect spoken text', async () => {
  for (const station of stations) {
    const slot = {
      value: 'unrecognized pronunciation',
      resolutions: {
        resolutionsPerAuthority: [{
          status: { code: 'ER_SUCCESS_MATCH' },
          values: [{ value: { id: station.id, name: station.label } }]
        }]
      }
    };
    assertPlay(await handler(intent('PlayStationIntent', slot)), station.id);
  }
});

test('unknown, missing, or ambiguous stations ask without starting or guessing a stream', async () => {
  for (const slot of [undefined, {}, { value: 'https://example.com/radio' }, { value: 'unknown station' }, { value: 42 }]) {
    assertPrompt(await handler(intent('PlayStationIntent', slot)));
  }
  const ambiguous = {
    value: 'radio',
    resolutions: {
      resolutionsPerAuthority: [{
        status: { code: 'ER_SUCCESS_MATCH' },
        values: [{ value: { id: 'one' } }, { value: { id: 'suomi' } }]
      }]
    }
  };
  assertPrompt(await handler(intent('PlayStationIntent', ambiguous)));
  ambiguous.resolutions.resolutionsPerAuthority[0].values = [{ value: { id: 'https://example.com/audio' } }];
  assertPrompt(await handler(intent('PlayStationIntent', ambiguous)));
});

test('pause, stop, and cancel stop audio and close the conversation', async () => {
  for (const name of ['AMAZON.PauseIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent']) {
    const result = await handler(intent(name));
    assert.equal(result.response.shouldEndSession, true);
    assert.deepEqual(result.response.directives, [{ type: 'AudioPlayer.Stop' }]);
  }
});

test('resume, repeat, and start over restart the known live station at zero', async () => {
  for (const name of ['AMAZON.ResumeIntent', 'AMAZON.RepeatIntent', 'AMAZON.StartOverIntent']) {
    for (const station of stations) {
      assertPlay(await handler(intent(name, undefined, playing(station.id))), station.id);
    }
    assertPrompt(await handler(intent(name)));
    assertPrompt(await handler(intent(name, undefined, { AudioPlayer: { token: 'https://example.com/audio' } })));
  }
});

test('next and previous select adjacent stations and wrap at the ends', async () => {
  for (let index = 0; index < stations.length; index += 1) {
    const context = playing(stations[index].id);
    assertPlay(await handler(intent('AMAZON.NextIntent', undefined, context)), stations[(index + 1) % stations.length].id);
    assertPlay(await handler(intent('AMAZON.PreviousIntent', undefined, context)), stations[(index - 1 + stations.length) % stations.length].id);
  }
  assertPrompt(await handler(intent('AMAZON.NextIntent')));
});

test('audio lifecycle callbacks without sessions return no speech, queue, or retry', async () => {
  for (const suffix of ['PlaybackStarted', 'PlaybackStopped', 'PlaybackFinished', 'PlaybackNearlyFinished']) {
    const request = event(`AudioPlayer.${suffix}`, { token: 'yle:one', error: { type: 'MEDIA_ERROR_SERVICE_UNAVAILABLE' } });
    assert.equal(request.session, undefined);
    assert.deepEqual(await handler(request), { version: '1.0', response: {} });
  }
});

test('playback failures log only a known station ID and allowed error code, without restarting audio', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    for (const fields of [
      { token: 'yle:one', error: { type: 'MEDIA_ERROR_SERVICE_UNAVAILABLE', message: 'private detail' } },
      { token: 'private token', error: { type: 'private error code', message: 'private detail' } },
      {}
    ]) {
      const request = event('AudioPlayer.PlaybackFailed', fields);
      request.context.System.user = { userId: 'private user ID' };
      assert.deepEqual(await handler(request), { version: '1.0', response: {} });
    }
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [
    ['AudioPlayer.PlaybackFailed', { stationId: 'one', errorType: 'MEDIA_ERROR_SERVICE_UNAVAILABLE' }],
    ['AudioPlayer.PlaybackFailed', { stationId: 'UNKNOWN', errorType: 'UNKNOWN' }],
    ['AudioPlayer.PlaybackFailed', { stationId: 'UNKNOWN', errorType: 'UNKNOWN' }]
  ]);
});

test('device playback buttons work without a session and never speak', async () => {
  for (const [command, expected] of [
    ['PlayCommandIssued', 'one'],
    ['NextCommandIssued', 'ylex'],
    ['PreviousCommandIssued', 'suomi']
  ]) {
    const result = await handler(event(`PlaybackController.${command}`, {}, playing('one')));
    assertPlay(result, expected, true);
    assert.equal(result.response.outputSpeech, undefined);
  }
  const pause = await handler(event('PlaybackController.PauseCommandIssued'));
  assert.deepEqual(Object.keys(pause.response), ['directives']);
  assert.deepEqual(pause.response.directives, [{ type: 'AudioPlayer.Stop' }]);
  assert.equal(pause.response.outputSpeech, undefined);
  assert.deepEqual(await handler(event('PlaybackController.PlayCommandIssued')), { version: '1.0', response: {} });
});

test('help and fallback invite a station choice; loop and shuffle leave audio untouched', async () => {
  assert.match((await handler(intent('AMAZON.HelpIntent'))).response.outputSpeech.text, /list channels/);
  for (const name of ['AMAZON.HelpIntent', 'AMAZON.FallbackIntent', 'UnknownIntent']) {
    assertPrompt(await handler(intent(name)));
  }
  for (const name of ['AMAZON.LoopOnIntent', 'AMAZON.LoopOffIntent', 'AMAZON.ShuffleOnIntent', 'AMAZON.ShuffleOffIntent']) {
    const result = await handler(intent(name, undefined, playing('one')));
    assert.equal(result.response.shouldEndSession, true);
    assert.equal(result.response.directives, undefined);
    assert.match(result.response.outputSpeech.text, /not available/);
  }
});

test('hosted availability checks never start audio', async () => {
  const viaContext = event('LaunchRequest');
  viaContext.context.System.user = { userId: 'alexa-lambda-availability' };
  const viaSession = event('LaunchRequest');
  viaSession.session = { user: { userId: 'alexa-lambda-availability' } };
  for (const request of [viaContext, viaSession]) {
    assert.deepEqual(await handler(request), { version: '1.0', response: {} });
  }
});

test('devices without AudioPlayer receive an explanation instead of a play directive', async () => {
  for (const context of [{}, { System: { device: { supportedInterfaces: { 'Alexa.Presentation.APL': {} } } } }]) {
    const result = await handler({ request: { type: 'LaunchRequest' }, context });
    assert.equal(result.response.shouldEndSession, true);
    assert.equal(result.response.directives, undefined);
    assert.match(result.response.outputSpeech.text, /does not support/);
  }
  const request = event('PlaybackController.PlayCommandIssued', {}, playing('one'));
  request.context.System.device.supportedInterfaces = {};
  assert.deepEqual(await handler(request), { version: '1.0', response: {} });
});

test('ended sessions, system errors, and malformed requests do not trigger playback or throw', async () => {
  for (const request of [undefined, null, {}, { request: null }, event('SessionEndedRequest'), event('System.ExceptionEncountered'), event('UnexpectedRequest')]) {
    assert.deepEqual(await handler(request), { version: '1.0', response: {} });
  }
  const malformed = intent('PlayStationIntent', { value: {}, resolutions: { resolutionsPerAuthority: {} } });
  assertPrompt(await handler(malformed));
});
