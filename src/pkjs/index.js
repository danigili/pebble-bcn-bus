/*
 * Phone side of BCN Bus.
 *
 * The watch has no network, so every request it makes arrives here as an
 * AppMessage, gets turned into an HTTPS call to the TMB API, and comes back
 * as a packed string.
 *
 * Favourites are owned by the watch: it pushes its list here so the settings
 * page can show and edit them, and an edit pushes the whole list back down.
 * That way saving a stop still works with the phone out of range.
 */

var TMB = require('./tmb');
var CONFIG = require('./config');

var SETTINGS_KEY = 'bcnbus:settings';
var FAVS_KEY = 'bcnbus:favs';
var STOPS_KEY = 'bcnbus:stops';

// Stops do not move. The list is fetched once and kept, and only looked at
// again when it is older than this.
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
        none: 'Cap parada a prop', stop: 'Parada' },
  es: { creds: 'Credenciales rechazadas', net: 'Sin conexion',
        http: 'Error del servidor', gps: 'Sin ubicacion',
        none: 'Ninguna parada cerca', stop: 'Parada' },
  en: { creds: 'Credentials rejected', net: 'No connection',
        http: 'Server error', gps: 'No location',
        none: 'No stops nearby', stop: 'Stop' }
};

// ------------------------------------------------------------- storage

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
    // Out of room: the search still works this time, it just pays for the
    // download again next time.
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

// For the log: how many distinct lines those arrivals cover, which is what
// tells a short answer from a stop that simply has one bus per line.
function countLines(arrivals) {
  var lines = {};
  var count = 0;
  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    if (!lines[key]) { lines[key] = true; count++; }
  }
  return count;
}

// A line's detail screen shows its next two buses, so a response where no
// line has a second one is either a quiet stop or a shape we are reading
// wrong. Only the response itself can tell those apart.
function anyLineHasTwo(arrivals) {
  var seen = {};
  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    if (seen[key]) return true;
    seen[key] = true;
  }
  return false;
}

function handleTimes(code) {
  httpGet(TMB.buildIbusUrl(code), function (json) {
    // Prefer the name the user gave the stop, then whatever the API knows,
    // and only then fall back to something built from the code.
    var name = favouriteName(code) ||
               TMB.pickStopName(json, code) ||
               (text('stop') + ' ' + code);

    var arrivals = TMB.parseArrivals(json, code);

    // A good answer we could make nothing of is worth seeing: this puts the
    // shape in `pebble logs` instead of leaving it to be guessed at.
    if (arrivals.length === 0) {
      console.log('no arrivals parsed from: ' +
                  JSON.stringify(json).substring(0, 300));
    } else {
      console.log('stop ' + code + ': ' + arrivals.length + ' arrivals, ' +
                  countLines(arrivals) + ' lines');

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
    sendError(message);
  });
}

// The stop list, from storage when it is there and from TMB when it is not.
// A list too old to trust is still better than no search at all, so a failed
// refresh falls back to it rather than to an error.
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

    // Rounded to about a hundred metres: enough to see at a glance whether
    // the fix is in Barcelona at all, which is half of what goes wrong here,
    // without writing someone's doorstep into a log.
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
  send({ MSG_TYPE: MSG_READY });
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
    lang: data.lang || 'ca',
    radius: data.radius || 500
  });

  var favs = data.favs || [];
  saveFavs(favs);
  send({ MSG_TYPE: MSG_FAVS, PAYLOAD: TMB.encodeStops(favs) });
});
