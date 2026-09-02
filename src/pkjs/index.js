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

// Kept short: the watch truncates these to 47 characters.
var TEXT = {
  ca: { creds: 'Falten credencials', net: 'Sense connexio',
        http: 'Error del servidor', gps: 'Sense ubicacio',
        none: 'Cap parada a prop', stop: 'Parada' },
  es: { creds: 'Faltan credenciales', net: 'Sin conexion',
        http: 'Error del servidor', gps: 'Sin ubicacion',
        none: 'Ninguna parada cerca', stop: 'Parada' },
  en: { creds: 'Missing credentials', net: 'No connection',
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

function httpGet(url, onOk, onFail) {
  var request = new XMLHttpRequest();
  request.open('GET', url, true);
  request.timeout = 15000;

  request.onload = function () {
    if (request.status >= 200 && request.status < 300) {
      var json;
      try {
        json = JSON.parse(request.responseText);
      } catch (e) {
        onFail(request.status, text('http'));
        return;
      }
      onOk(json);
    } else if (request.status === 401 || request.status === 403) {
      onFail(request.status, text('creds'));
    } else {
      onFail(request.status, text('http'));
    }
  };
  request.onerror = function () { onFail(0, text('net')); };
  request.ontimeout = function () { onFail(0, text('net')); };
  request.send();
}

function hasCredentials(settings) {
  return !!(settings.app_id && settings.app_key);
}

// -------------------------------------------------------------- actions

function favouriteName(code) {
  var favs = loadFavs();
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].code === code) return favs[i].name;
  }
  return '';
}

function handleTimes(code) {
  var settings = loadSettings();
  if (!hasCredentials(settings)) {
    sendError(text('creds'));
    return;
  }

  httpGet(TMB.buildIbusUrl(settings, code), function (json) {
    // Prefer the name the user gave the stop, then whatever the API knows,
    // and only then fall back to something built from the code.
    var name = favouriteName(code) ||
               TMB.pickStopName(json, code) ||
               (text('stop') + ' ' + code);

    send({
      MSG_TYPE: MSG_TIMES,
      PAYLOAD: TMB.encodeArrivals(TMB.parseArrivals(json)),
      TITLE: TMB.sanitize(name).substring(0, 26)
    });
  }, function (status, message) {
    sendError(message);
  });
}

function tryNearby(urls, index, lat, lon) {
  if (index >= urls.length) {
    sendError(text('none'));
    return;
  }

  httpGet(urls[index], function (json) {
    var stops = TMB.parseNearby(json, lat, lon).slice(0, 16);
    if (stops.length === 0) {
      tryNearby(urls, index + 1, lat, lon);
      return;
    }
    send({ MSG_TYPE: MSG_NEARBY, PAYLOAD: TMB.encodeStops(stops) });
  }, function () {
    tryNearby(urls, index + 1, lat, lon);
  });
}

function handleNearby() {
  var settings = loadSettings();
  if (!hasCredentials(settings)) {
    sendError(text('creds'));
    return;
  }

  navigator.geolocation.getCurrentPosition(function (position) {
    var lat = position.coords.latitude;
    var lon = position.coords.longitude;
    tryNearby(TMB.buildNearbyUrls(settings, lat, lon, settings.radius || 500),
              0, lat, lon);
  }, function () {
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
    app_id: data.app_id || '',
    app_key: data.app_key || '',
    lang: data.lang || 'ca',
    radius: data.radius || 500
  });

  var favs = data.favs || [];
  saveFavs(favs);
  send({ MSG_TYPE: MSG_FAVS, PAYLOAD: TMB.encodeStops(favs) });
});
