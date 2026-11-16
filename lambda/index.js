'use strict';

const stations = require('./stations.json');
const stationsById = new Map(stations.map((station) => [station.id, station]));
const defaultStation = stationsById.get('suomi');
const stationPrompt = 'Say a station, such as Radio Suomi, Radio One, Yle X, classical, Vega, X three M, Sami, or Lapland.';
const playbackErrorTypes = new Set([
  'MEDIA_ERROR_UNKNOWN',
  'MEDIA_ERROR_INVALID_REQUEST',
  'MEDIA_ERROR_SERVICE_UNAVAILABLE',
  'MEDIA_ERROR_INTERNAL_SERVER_ERROR',
  'MEDIA_ERROR_INTERNAL_DEVICE_ERROR'
]);

function normalize(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

const stationsByAlias = new Map();
for (const station of stations) {
  for (const alias of [station.id, station.label, ...station.aliases]) {
    stationsByAlias.set(normalize(alias), station);
  }
}

function response(body = {}) {
  return { version: '1.0', response: body };
}

function say(text, keepListening = false) {
  const body = {
    outputSpeech: { type: 'PlainText', text },
    shouldEndSession: !keepListening
  };
  if (keepListening) {
    body.reprompt = { outputSpeech: { type: 'PlainText', text: stationPrompt } };
  }
  return response(body);
}

function askForStation(prefix = '') {
  return say(`${prefix}${stationPrompt}`, true);
}

function audioSupported(event) {
  const interfaces = event?.context?.System?.device?.supportedInterfaces;
  return Boolean(interfaces && Object.prototype.hasOwnProperty.call(interfaces, 'AudioPlayer'));
}

function currentStation(event) {
  const token = event?.context?.AudioPlayer?.token;
  if (typeof token !== 'string' || !token.startsWith('yle:')) return undefined;
  return stationsById.get(token.slice(4));
}

function resolveStation(slot) {
  if (!slot || typeof slot !== 'object') return undefined;
  const authorities = slot.resolutions?.resolutionsPerAuthority;
  const matches = new Set();
  if (Array.isArray(authorities)) {
    for (const authority of authorities) {
      if (authority?.status?.code !== 'ER_SUCCESS_MATCH' || !Array.isArray(authority.values)) continue;
      for (const match of authority.values) {
        const id = match?.value?.id;
        if (stationsById.has(id)) matches.add(id);
      }
    }
  }
  if (matches.size > 1) return undefined;
  if (matches.size === 1) return stationsById.get(matches.values().next().value);
  return stationsByAlias.get(normalize(slot.value));
}

function play(station, event, announce = true) {
  if (!audioSupported(event)) {
    return announce ? say('This device does not support radio playback. Please ask your Echo instead.') : response();
  }
  const body = {
    directives: [{
      type: 'AudioPlayer.Play',
      playBehavior: 'REPLACE_ALL',
      audioItem: {
        stream: {
          token: `yle:${station.id}`,
          url: station.url,
          offsetInMilliseconds: 0
        }
      }
    }]
  };
  if (announce) {
    body.outputSpeech = { type: 'PlainText', text: `Playing ${station.speech}.` };
    body.shouldEndSession = true;
  }
  return response(body);
}

function stop(endSession = true) {
  const body = { directives: [{ type: 'AudioPlayer.Stop' }] };
  if (endSession) body.shouldEndSession = true;
  return response(body);
}

function restart(event, announce = true) {
  const station = currentStation(event);
  if (!station) return announce ? askForStation('Which station would you like? ') : response();
  return play(station, event, announce);
}

function changeStation(event, direction, announce = true) {
  const station = currentStation(event);
  if (!station) return announce ? askForStation('Which station would you like? ') : response();
  const index = stations.indexOf(station);
  const nextIndex = (index + direction + stations.length) % stations.length;
  return play(stations[nextIndex], event, announce);
}

exports.handler = async (event) => {
  const request = event?.request;
  const type = request?.type;
  const isCallback = typeof type === 'string' && (type.startsWith('AudioPlayer.') || type.startsWith('PlaybackController.'));

  try {
    // Alexa-hosted availability checks must not start a broadcast.
    if (event?.context?.System?.user?.userId === 'alexa-lambda-availability' ||
        event?.session?.user?.userId === 'alexa-lambda-availability') return response();

    if (type === 'LaunchRequest') return play(defaultStation, event);

    if (type === 'AudioPlayer.PlaybackFailed') {
      const token = request.token;
      const station = typeof token === 'string' && token.startsWith('yle:')
        ? stationsById.get(token.slice(4)) : undefined;
      const errorType = request.error?.type;
      console.warn('AudioPlayer.PlaybackFailed', {
        stationId: station?.id ?? 'UNKNOWN',
        errorType: playbackErrorTypes.has(errorType) ? errorType : 'UNKNOWN'
      });
    }

    // Live streams have no next track to enqueue. Do not retry failed streams.
    if (typeof type === 'string' && type.startsWith('AudioPlayer.')) return response();

    switch (type) {
      case 'SessionEndedRequest':
      case 'System.ExceptionEncountered':
        return response();
      case 'PlaybackController.PlayCommandIssued':
        return restart(event, false);
      case 'PlaybackController.PauseCommandIssued':
        return stop(false);
      case 'PlaybackController.NextCommandIssued':
        return changeStation(event, 1, false);
      case 'PlaybackController.PreviousCommandIssued':
        return changeStation(event, -1, false);
      case 'IntentRequest': {
        const intent = request.intent;
        switch (intent?.name) {
          case 'PlayStationIntent': {
            const station = resolveStation(intent.slots?.station);
            return station ? play(station, event) : askForStation('I did not recognize that station. ');
          }
          case 'AMAZON.PauseIntent':
          case 'AMAZON.StopIntent':
          case 'AMAZON.CancelIntent':
            return stop();
          case 'AMAZON.ResumeIntent':
          case 'AMAZON.StartOverIntent':
          case 'AMAZON.RepeatIntent':
            return restart(event);
          case 'AMAZON.NextIntent':
            return changeStation(event, 1);
          case 'AMAZON.PreviousIntent':
            return changeStation(event, -1);
          case 'AMAZON.LoopOnIntent':
          case 'AMAZON.LoopOffIntent':
          case 'AMAZON.ShuffleOnIntent':
          case 'AMAZON.ShuffleOffIntent':
            return say('Loop and shuffle are not available for live radio.');
          case 'AMAZON.HelpIntent':
            return askForStation();
          case 'AMAZON.FallbackIntent':
          default:
            return askForStation('I did not understand. ');
        }
      }
      default:
        return response();
    }
  } catch {
    // Never include request data, user IDs, or access tokens in an error response.
    return isCallback ? response() : say('Sorry, I could not start the radio. Please try again.');
  }
};
