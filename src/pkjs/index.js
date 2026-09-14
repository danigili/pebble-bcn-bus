/*
 * Phone side of BCN Bus.
 *
 * The watch has no network, so every request it makes arrives here as an
 * AppMessage, becomes an HTTPS call to the TMB API, and goes back as a
 * packed string.
 *
 * The watch owns the kept stops: it pushes its list here for the settings
 * page, and an edit pushes the whole list back down.
 */

var TMB = require('./tmb');
var CONFIG = require('./config');

var SETTINGS_KEY = 'bcnbus:settings';
var FAVS_KEY = 'bcnbus:favs';
var STOPS_KEY = 'bcnbus:stops';
var LINES_KEY = 'bcnbus:lines';

// How old the stop and line lists may get before they are fetched again.
var STOPS_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
var STOPS_TIMEOUT = 45000;   // it is every stop TMB runs, so allow for it

// watch -> phone
var CMD_REQ_TIMES = 1;
var CMD_REQ_NEARBY = 2;
var CMD_SYNC_FAVS = 3;

// phone -> watch
var MSG_FAVS = 1;
var MSG_TIMES = 2;
var MSG_ERROR = 3;
var MSG_READY = 4;
var MSG_NEARBY = 5;

var LANGS = { ca: 0, es: 1, en: 2 };

var MAX_NEARBY = 16;   // the watch keeps this many

// Kept short: the watch truncates these to 47 characters.
var TEXT = {
  ca: { creds: 'Credencials rebutjades', net: 'Sense connexio',
        http: 'Error del servidor', gps: 'Sense ubicacio',
        none: 'Cap parada a prop', stop: 'Parada',
        nostop: 'Aquesta parada no existeix' },
  es: { creds: 'Credenciales rechazadas', net: 'Sin conexion',
        http: 'Error del servidor', gps: 'Sin ubicacion',
        none: 'Ninguna parada cerca', stop: 'Parada',
        nostop: 'Esa parada no existe' },
  en: { creds: 'Credentials rejected', net: 'No connection',
        http: 'Server error', gps: 'No location',
        none: 'No stops nearby', stop: 'Stop',
        nostop: 'No such stop' }
};

// ------------------------------------------------------------- storage

// The user's own credentials, when they have entered a pair.
function applyCredentials() {
  var settings = loadSettings();
  TMB.useCredentials(settings.app_id, settings.app_key);
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.log('could not persist settings: ' + e);
  }
}

function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(FAVS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveFavs(favs) {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
  } catch (e) {
    console.log('could not persist favourites: ' + e);
  }
}

// The line colours, by line name, fetched once and kept.
function loadLineColors() {
  try {
    return JSON.parse(localStorage.getItem(LINES_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function saveLineColors(colors) {
  try {
    localStorage.setItem(LINES_KEY, JSON.stringify({
      at: Date.now(),
      colors: colors
    }));
  } catch (e) {
    console.log('could not keep the line colours: ' + e);
  }
}

// In the background: times go out with whatever colours are known.
function refreshLineColors() {
  var cached = loadLineColors();
  if (cached && (Date.now() - (cached.at || 0)) < STOPS_MAX_AGE) return;

  httpGet(TMB.buildLinesUrl(), function (json) {
    var colors = TMB.parseLineColors(json);
    var found = 0;
    for (var name in colors) { if (colors[name]) found++; }
    console.log('lines: ' + found + ' with a colour');

    if (found > 0) saveLineColors(colors);
    else console.log('lines: no colour in ' +
                     JSON.stringify(json).substring(0, 300));
  }, function (status, message, body) {
    console.log('lines: HTTP ' + status + ' ' +
                String(body || '').substring(0, 200));
  }, STOPS_TIMEOUT);
}

var NIGHT_COLOR = TMB.shortColor('1B3D8F');   // the Nitbus dark blue
var AMB_COLOR   = TMB.shortColor('FFD800');   // the AMB's yellow

// For lines TMB's list does not carry, which is every line the other AMB
// operators run. Night buses first: the Nitbus is the AMB's too, and an N in
// the name beats knowing who drives it.
function fallbackColor(arrival) {
  if (arrival.line.charAt(0).toUpperCase() === 'N') return NIGHT_COLOR;
  if (arrival.amb) return AMB_COLOR;
  return '';    // nothing to say: the watch guesses from the name
}

function paint(arrivals) {
  var cached = loadLineColors();
  var colors = (cached && cached.colors) || {};

  for (var i = 0; i < arrivals.length; i++) {
    arrivals[i].color = colors[arrivals[i].line.toUpperCase()] ||
                        fallbackColor(arrivals[i]);
  }
  return arrivals;
}

function loadStopIndex() {
  try {
    return JSON.parse(localStorage.getItem(STOPS_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function saveStopIndex(index) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify({
      at: Date.now(),
      list: index
    }));
  } catch (e) {
    // Out of room: the search still works, it just downloads again next
    // time.
    console.log('could not keep the stop list: ' + e);
  }
}

function text(key) {
  var lang = loadSettings().lang;
  return (TEXT[lang] || TEXT.ca)[key];
}

function langCode() {
  var lang = loadSettings().lang;
  return LANGS[lang] === undefined ? LANGS.ca : LANGS[lang];
}

// --------------------------------------------------------------- comms

function send(message) {
  message.LANG = langCode();
  Pebble.sendAppMessage(message, null, function (e) {
    console.log('sendAppMessage failed: ' + JSON.stringify(e));
  });
}

function sendError(message) {
  send({ MSG_TYPE: MSG_ERROR, PAYLOAD: String(message).substring(0, 47) });
}

function httpGet(url, onOk, onFail, timeout) {
  var request = new XMLHttpRequest();
  request.open('GET', url, true);
  request.timeout = timeout || 15000;

  request.onload = function () {
    if (request.status >= 200 && request.status < 300) {
      var json;
      try {
        json = JSON.parse(request.responseText);
      } catch (e) {
        onFail(request.status, text('http'), request.responseText);
        return;
      }
      onOk(json);
    } else if (request.status === 401 || request.status === 403) {
      onFail(request.status, text('creds'), request.responseText);
    } else {
      onFail(request.status, text('http'), request.responseText);
    }
  };
  request.onerror = function () { onFail(0, text('net')); };
  request.ontimeout = function () { onFail(0, text('net')); };
  request.send();
}

// -------------------------------------------------------------- actions

function favouriteName(code) {
  var favs = loadFavs();
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].code === code) return favs[i].name;
  }
  return '';
}

// For the log: how many distinct lines those arrivals cover.
function countLines(arrivals) {
  var lines = {};
  var count = 0;
  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    if (!lines[key]) { lines[key] = true; count++; }
  }
  return count;
}

// For the log: how many buses each line has, as "V31x1 V33x2".
function census(arrivals) {
  var counts = {};
  var order = [];

  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    if (!counts[key]) { counts[key] = 0; order.push(arrivals[i].line); }
    counts[key]++;
  }
  return order.map(function (line) {
    return line + 'x' + counts['#' + line];
  }).join(' ');
}

function anyLineHasTwo(arrivals) {
  var seen = {};
  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    if (seen[key]) return true;
    seen[key] = true;
  }
  return false;
}

// For the log: which of the response shapes it was read out of.
function shapeOf(json) {
  if (json && json.parades) return 'parades';
  if (json && json.data && json.data.parades) return 'data.parades';
  if (json && json.data && json.data.ibus) return 'data.ibus';
  return 'unknown';
}

function handleTimes(code) {
  httpGet(TMB.buildTimesUrl(code), function (json) {
    // A code nobody has heard of, rather than a stop with nothing due: say
    // so instead of answering about a stop that does not exist.
    if (!TMB.namesStop(json, code)) {
      console.log('stop ' + code + ': not in the answer');
      sendError(text('nostop'));
      return;
    }

    // The name the user gave it, then the API's, then one built from the
    // code.
    var name = favouriteName(code) ||
               TMB.pickStopName(json, code) ||
               (text('stop') + ' ' + code);

    var arrivals = paint(TMB.parseArrivals(json, code));

    // An answer we could make nothing of goes to `pebble logs` whole.
    if (arrivals.length === 0) {
      console.log('no arrivals parsed from: ' +
                  JSON.stringify(json).substring(0, 300));
    } else {
      console.log('stop ' + code + ' [' + shapeOf(json) + ']: ' +
                  census(arrivals));

      if (!anyLineHasTwo(arrivals)) {
        console.log('stop ' + code + ': not one line has a second bus; ' +
                    'raw: ' + JSON.stringify(json).substring(0, 500));
      }
    }

    send({
      MSG_TYPE: MSG_TIMES,
      PAYLOAD: TMB.encodeArrivals(arrivals),
      TITLE: TMB.sanitize(name).substring(0, 26)
    });
  }, function (status, message) {
    sendError(status === 404 ? text('nostop') : message);
  });
}

// The stop list, from storage when it is there and from TMB when it is not.
// A failed refresh falls back to the old list rather than to an error.
function withStopIndex(onReady, onFail) {
  var cached = loadStopIndex();
  var usable = cached && cached.list && cached.list.length;

  if (usable && (Date.now() - (cached.at || 0)) < STOPS_MAX_AGE) {
    onReady(cached.list);
    return;
  }

  console.log('stops: fetching the list' + (usable ? ' again' : ''));

  httpGet(TMB.buildStopsUrl(), function (json) {
    var index = TMB.parseStopIndex(json);
    console.log('stops: ' + index.length + ' with a position');

    if (index.length === 0) {
      if (usable) { onReady(cached.list); return; }
      console.log('stops: nothing usable in ' +
                  JSON.stringify(json).substring(0, 300));
      onFail(text('none'));
      return;
    }

    saveStopIndex(index);
    onReady(index);
  }, function (status, message, body) {
    console.log('stops: HTTP ' + status + ' ' +
                String(body || '').substring(0, 200));
    if (usable) { onReady(cached.list); return; }
    onFail(message);
  }, STOPS_TIMEOUT);
}

function handleNearby() {
  var settings = loadSettings();

  navigator.geolocation.getCurrentPosition(function (position) {
    var lat = position.coords.latitude;
    var lon = position.coords.longitude;
    var radius = settings.radius || 500;

    // Rounded to about a hundred metres: enough to tell whether the fix is
    // in Barcelona at all, without writing a doorstep into a log.
    console.log('nearby: fix near ' + lat.toFixed(3) + ',' + lon.toFixed(3) +
                ' radius ' + radius + 'm');

    withStopIndex(function (index) {
      var stops = TMB.nearestStops(index, lat, lon, radius, MAX_NEARBY);

      if (stops.length === 0) {
        console.log('nearby: nothing within ' + radius + 'm of the fix');
        sendError(text('none'));
        return;
      }

      console.log('nearby: ' + stops.length + ' stops, nearest ' +
                  Math.round(stops[0].dist) + 'm');
      send({ MSG_TYPE: MSG_NEARBY, PAYLOAD: TMB.encodeStops(stops) });
    }, sendError);
  }, function (error) {
    console.log('nearby: no position (' + (error && error.message) + ')');
    sendError(text('gps'));
  }, { timeout: 15000, maximumAge: 60000 });
}

// --------------------------------------------------------------- events

Pebble.addEventListener('ready', function () {
  applyCredentials();
  send({ MSG_TYPE: MSG_READY });
  refreshLineColors();
});

Pebble.addEventListener('appmessage', function (event) {
  var payload = event.payload || {};

  switch (payload.CMD) {
    case CMD_REQ_TIMES:
      handleTimes(String(payload.STOP_CODE || '').replace(/[^0-9]/g, ''));
      break;
    case CMD_REQ_NEARBY:
      handleNearby();
      break;
    case CMD_SYNC_FAVS:
      saveFavs(TMB.parseStops(payload.PAYLOAD || ''));
      break;
    default:
      break;
  }
});

Pebble.addEventListener('showConfiguration', function () {
  var html = CONFIG.buildConfigPage(loadSettings(), loadFavs());
  Pebble.openURL('data:text/html,' + encodeURIComponent(html));
});

Pebble.addEventListener('webviewclosed', function (event) {
  if (!event || !event.response) return;

  var data;
  try {
    data = JSON.parse(decodeURIComponent(event.response));
  } catch (e) {
    try {
      data = JSON.parse(event.response);
    } catch (e2) {
      console.log('unreadable settings response');
      return;
    }
  }

  saveSettings({
    app_id: data.app_id || '',
    app_key: data.app_key || '',
    lang: data.lang || 'ca',
    radius: data.radius || 500
  });
  applyCredentials();

  var favs = data.favs || [];
  saveFavs(favs);
  send({ MSG_TYPE: MSG_FAVS, PAYLOAD: TMB.encodeStops(favs) });
});
