/*
 * Talking to the TMB API, and packing the answers into the compact strings
 * the watch parses.
 *
 * Everything here is a pure function so it can be exercised from Node
 * without a phone or a watch; see tools/test-pkjs.js.
 *
 * The iBus response shape is documented at developer.tmb.cat. The field
 * carrying the destination is not something we could confirm, so instead of
 * betting on one name we probe the plausible ones and simply leave the
 * destination out when none of them is present.
 */

var BASE = 'https://api.tmb.cat/v1';

var MAX_PAYLOAD = 900;   // keep well inside the watch's AppMessage inbox
var MAX_DEST    = 24;

var LINE_KEYS = ['line', 'routeId', 'route', 'LINIA', 'linia', 'nom_linia'];
var MIN_KEYS  = ['t-in-min', 'tInMin', 'temps_min', 'minutes'];
var SEC_KEYS  = ['t-in-s', 'tInS', 'temps_s', 'seconds'];
var DEST_KEYS = ['destination', 'desti', 'destino', 'DESTI', 'destinacio',
                 'headsign', 'trip_headsign', 'NOM_DESTI'];

var CODE_KEYS = ['CODI_PARADA', 'codi_parada', 'CODI', 'codi', 'ID_PARADA',
                 'stop_code', 'code'];
var NAME_KEYS = ['NOM_PARADA', 'nom_parada', 'NOM', 'nom', 'ADRECA',
                 'adreca', 'name'];

function firstString(obj, keys) {
  if (!obj) return '';
  for (var i = 0; i < keys.length; i++) {
    var value = obj[keys[i]];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function firstNumber(obj, keys) {
  if (!obj) return null;
  for (var i = 0; i < keys.length; i++) {
    var value = obj[keys[i]];
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

// The separators are structural, so they must never survive inside a field.
function sanitize(text) {
  return String(text === undefined || text === null ? '' : text)
      .replace(/[|;]/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
}

function auth(creds) {
  return 'app_id=' + encodeURIComponent(creds.app_id || '') +
         '&app_key=' + encodeURIComponent(creds.app_key || '');
}

function buildIbusUrl(creds, stopCode) {
  return BASE + '/ibus/stops/' + encodeURIComponent(stopCode) + '?' + auth(creds);
}

// The stops endpoint takes a CQL filter. We could not verify which spatial
// predicate it accepts, so try the distance form first and fall back to a
// bounding box, which is the more widely supported of the two.
function buildNearbyUrls(creds, lat, lon, radius) {
  var base = BASE + '/transit/parades?' + auth(creds);
  var dLat = radius / 111320;
  var dLon = radius / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));

  var dwithin = 'DWITHIN(geometria,POINT(' + lon + ' ' + lat + '),' +
                radius + ',meters)';
  var bbox = 'BBOX(geometria,' + (lon - dLon) + ',' + (lat - dLat) + ',' +
             (lon + dLon) + ',' + (lat + dLat) + ')';

  return [
    base + '&filter=' + encodeURIComponent(dwithin),
    base + '&filter=' + encodeURIComponent(bbox)
  ];
}

function parseArrivals(json) {
  var raw = json && json.data && json.data.ibus;
  if (!raw) return [];
  if (!Array.isArray(raw)) raw = [raw];

  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item) continue;

    var line = sanitize(firstString(item, LINE_KEYS));
    if (!line) continue;

    var mins = firstNumber(item, MIN_KEYS);
    if (mins === null) {
      var seconds = firstNumber(item, SEC_KEYS);
      if (seconds !== null) mins = Math.round(seconds / 60);
    }
    if (mins === null || mins < 0) mins = -1;

    // Some fields hold a phrase like "3 min" rather than a destination;
    // those are the waiting time again, not somewhere the bus is going.
    var dest = sanitize(firstString(item, DEST_KEYS));
    if (/\d+\s*min/i.test(dest)) dest = '';

    out.push({ line: line, mins: mins, dest: dest.substring(0, MAX_DEST) });
  }

  out.sort(function (a, b) {
    if (a.mins < 0 && b.mins < 0) return 0;
    if (a.mins < 0) return 1;
    if (b.mins < 0) return -1;
    return a.mins - b.mins;
  });
  return out;
}

function haversine(lat1, lon1, lat2, lon2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLon = (lon2 - lon1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseNearby(json, lat, lon) {
  var features = (json && json.features) || [];
  var out = [];

  for (var i = 0; i < features.length; i++) {
    var feature = features[i] || {};
    var props = feature.properties || {};

    var code = sanitize(firstString(props, CODE_KEYS));
    if (!code) continue;

    var name = sanitize(firstString(props, NAME_KEYS)) || code;
    var distance = Number.MAX_VALUE;
    var coords = feature.geometry && feature.geometry.coordinates;
    if (coords && coords.length >= 2) {
      distance = haversine(lat, lon, coords[1], coords[0]);
    }
    out.push({ code: code, name: name, dist: distance });
  }

  out.sort(function (a, b) { return a.dist - b.dist; });
  return out;
}

function pickStopName(json, code) {
  var raw = json && json.data && json.data.ibus;
  if (raw && !Array.isArray(raw)) raw = [raw];
  if (raw && raw.length) {
    var name = sanitize(firstString(raw[0], NAME_KEYS));
    if (name) return name;
  }
  return '';
}

function encodeArrivals(arrivals) {
  var parts = [];
  var length = 0;

  for (var i = 0; i < arrivals.length; i++) {
    var a = arrivals[i];
    var record = a.line + '|' + a.mins + '|' + a.dest + ';';
    if (length + record.length > MAX_PAYLOAD) break;
    parts.push(record);
    length += record.length;
  }
  return parts.join('');
}

function encodeStops(stops) {
  var parts = [];
  var length = 0;

  for (var i = 0; i < stops.length; i++) {
    var record = sanitize(stops[i].code) + '|' +
                 sanitize(stops[i].name).substring(0, MAX_DEST) + ';';
    if (length + record.length > MAX_PAYLOAD) break;
    parts.push(record);
    length += record.length;
  }
  return parts.join('');
}

function parseStops(payload) {
  var out = [];
  var records = String(payload || '').split(';');

  for (var i = 0; i < records.length; i++) {
    if (!records[i]) continue;
    var fields = records[i].split('|');
    if (!fields[0]) continue;
    out.push({ code: fields[0], name: fields[1] || fields[0] });
  }
  return out;
}

var TMB = {
  BASE: BASE,
  sanitize: sanitize,
  buildIbusUrl: buildIbusUrl,
  buildNearbyUrls: buildNearbyUrls,
  parseArrivals: parseArrivals,
  parseNearby: parseNearby,
  pickStopName: pickStopName,
  encodeArrivals: encodeArrivals,
  encodeStops: encodeStops,
  parseStops: parseStops,
  haversine: haversine
};

if (typeof module !== 'undefined' && module.exports) module.exports = TMB;
