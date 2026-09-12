/*
 * Talking to the TMB API, and packing the answers into the compact strings
 * the watch parses.
 *
 * Everything here is a pure function so it can be exercised from Node
 * without a phone or a watch; see tools/test-pkjs.js.
 *
 * The iBus response looks like this:
 *
 *   { timestamp, parades: [ { codi_parada, nom_parada, linies_trajectes: [
 *       { nom_linia, desti_trajecte, propers_busos: [ { temps_arribada } ] }
 *     ] } ] }
 *
 * Arrival times are absolute epoch milliseconds, so a waiting time is a
 * subtraction. It is measured against the response's own timestamp and not
 * the phone's clock: the two need not agree, and the server's is the one the
 * prediction was made against.
 */

var BASE = 'https://api.tmb.cat/v1';

// The app's own TMB credentials, shipped with it so there is nothing to set
// up before the first bus time shows up. They ride along in the JS bundle
// that reaches the phone, so they are public in practice: if the quota ever
// runs out or they leak, regenerate them at developer.tmb.cat.
var APP_ID  = 'd4ef8b79';
var APP_KEY = '71f41c220aa7bcada2565b4ce0dd4ddd';

var MAX_PAYLOAD = 900;   // keep well inside the watch's AppMessage inbox
var MAX_DEST    = 24;

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

// The separators are structural, so they must never survive inside a field.
function sanitize(text) {
  return String(text === undefined || text === null ? '' : text)
      .replace(/[|;]/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
}

function auth() {
  return 'app_id=' + encodeURIComponent(APP_ID) +
         '&app_key=' + encodeURIComponent(APP_KEY);
}

function buildIbusUrl(stopCode) {
  return BASE + '/ibus/stops/' + encodeURIComponent(stopCode) + '?' + auth();
}

// The stops endpoint takes a CQL filter. We could not verify which spatial
// predicate it accepts, so try the distance form first and fall back to a
// bounding box, which is the more widely supported of the two.
function buildNearbyUrls(lat, lon, radius) {
  var base = BASE + '/transit/parades?' + auth();
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

function listOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// The endpoint is asked about one stop, but it answers with a list, so pick
// the stop that was asked for and fall back to whatever came back.
function findStop(json, code) {
  var parades = listOf(json && json.parades);
  for (var i = 0; i < parades.length; i++) {
    if (parades[i] && String(parades[i].codi_parada) === String(code)) {
      return parades[i];
    }
  }
  return parades[0] || null;
}

function minutesUntil(arrival, now) {
  if (typeof arrival !== 'number' || !isFinite(arrival)) return null;
  var mins = Math.round((arrival - now) / 60000);
  return mins < 0 ? 0 : mins;   // a bus that is overdue is arriving, not late
}

function parseArrivals(json, code) {
  var stop = findStop(json, code);
  if (!stop) return [];

  var now = (json && typeof json.timestamp === 'number') ? json.timestamp
                                                         : Date.now();
  var trips = listOf(stop.linies_trajectes);
  var out = [];

  for (var i = 0; i < trips.length; i++) {
    var trip = trips[i] || {};

    // nom_linia is what the stop sign says ("H12"); codi_linia is TMB's
    // internal number for it ("212"), which is no use to anyone waiting.
    var line = sanitize(trip.nom_linia || trip.codi_linia);
    if (!line) continue;

    var dest = sanitize(trip.desti_trajecte).substring(0, MAX_DEST);
    var buses = listOf(trip.propers_busos);

    // One row per bus, not per line: the next two buses of the same line,
    // ten minutes apart, is exactly what someone at the stop wants to see.
    for (var j = 0; j < buses.length; j++) {
      var mins = minutesUntil(buses[j] && buses[j].temps_arribada, now);
      if (mins === null) continue;
      out.push({ line: line, mins: mins, dest: dest });
    }
  }

  out.sort(function (a, b) { return a.mins - b.mins; });
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
  var stop = findStop(json, code);
  return stop ? sanitize(stop.nom_parada) : '';
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
  APP_ID: APP_ID,
  APP_KEY: APP_KEY,
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
