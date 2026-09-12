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
 *
 * Everything below is deliberately forgiving about how that arrives: numbers
 * quoted as strings, epochs in seconds, the whole thing wrapped in a "data"
 * envelope, and the older { data: { ibus: [...] } } shape, which some
 * deployments still answer with. Reading a live response from here is not
 * possible, so the parser accepts what it is given rather than insisting.
 */

var BASE = 'https://api.tmb.cat/v1';

// The app's own TMB credentials, shipped with it so there is nothing to set
// up before the first bus time shows up. They ride along in the JS bundle
// that reaches the phone, so they are public in practice: if the quota ever
// runs out or they leak, regenerate them at developer.tmb.cat.
var APP_ID  = 'd4ef8b79';
var APP_KEY = '71f41c220aa7bcada2565b4ce0dd4ddd';

var MAX_PAYLOAD  = 900;   // keep well inside the watch's AppMessage inbox
var MAX_DEST     = 24;
var MAX_PER_LINE = 3;     // nobody is waiting for the fourth bus of one line

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

// The stops endpoint takes a CQL filter, and which spatial predicate it
// accepts has never been confirmed against the live service. So this returns
// a list of candidates to be tried in turn, each with a name, because the
// one that works is worth knowing: the caller logs it.
//
// Two unknowns, four combinations. The predicate (a distance query, or the
// bounding box that is more widely supported), and the case of the geometry
// column: CQL attribute names are case sensitive, and every other property
// of these stops comes back shouting (CODI_PARADA, NOM_PARADA), so the
// column is as likely to be GEOMETRIA as geometria.
function buildNearbyUrls(lat, lon, radius) {
  var base = BASE + '/transit/parades?' + auth();
  var dLat = radius / 111320;
  var dLon = radius / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  var out = [];

  var columns = ['GEOMETRIA', 'geometria'];
  for (var i = 0; i < columns.length; i++) {
    var column = columns[i];
    out.push({
      name: 'DWITHIN/' + column,
      url: base + '&filter=' + encodeURIComponent(
          'DWITHIN(' + column + ',POINT(' + lon + ' ' + lat + '),' +
          radius + ',meters)')
    });
    out.push({
      name: 'BBOX/' + column,
      url: base + '&filter=' + encodeURIComponent(
          'BBOX(' + column + ',' + (lon - dLon) + ',' + (lat - dLat) + ',' +
          (lon + dLon) + ',' + (lat + dLat) + ')')
    });
  }
  return out;
}

function listOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

// Epochs turn up in seconds as often as in milliseconds. 1e9 seconds is
// 2001 and 1e11 is the year 5138, so a number in that band is seconds and
// anything outside it is taken as it comes.
function toMillis(value) {
  var n = toNumber(value);
  if (n === null) return null;
  return (n >= 1e9 && n < 1e11) ? n * 1000 : n;
}

// The stops, wherever they are: at the root, or inside a "data" envelope.
function paradesOf(json) {
  if (!json) return [];
  if (json.parades) return listOf(json.parades);
  if (json.data && json.data.parades) return listOf(json.data.parades);
  return [];
}

// The endpoint is asked about one stop, but it answers with a list, so pick
// the stop that was asked for and fall back to whatever came back.
function findStop(json, code) {
  var parades = paradesOf(json);
  for (var i = 0; i < parades.length; i++) {
    if (parades[i] && String(parades[i].codi_parada) === String(code)) {
      return parades[i];
    }
  }
  return parades[0] || null;
}

function minutesUntil(arrival, now) {
  var at = toMillis(arrival);
  if (at === null) return null;
  var mins = Math.round((at - now) / 60000);
  return mins < 0 ? 0 : mins;   // a bus that is overdue is arriving, not late
}

function fromParades(json, code) {
  var stop = findStop(json, code);
  if (!stop) return [];

  var stamp = toMillis(json && json.timestamp);
  var now = (stamp === null) ? Date.now() : stamp;
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
  return out;
}

// The older shape, kept as a fallback: one flat entry per line, carrying the
// waiting time already worked out.
var OLD_LINE_KEYS = ['line', 'routeId', 'route', 'nom_linia', 'linia'];
var OLD_MIN_KEYS  = ['t-in-min', 'tInMin', 'temps_min', 'minutes'];
var OLD_SEC_KEYS  = ['t-in-s', 'tInS', 'temps_s', 'seconds'];
var OLD_DEST_KEYS = ['destination', 'desti', 'desti_trajecte', 'headsign'];

function firstNumber(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var value = toNumber(obj[keys[i]]);
    if (value !== null) return value;
  }
  return null;
}

function fromIbus(json) {
  var raw = listOf(json && json.data && json.data.ibus);
  var out = [];

  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item) continue;

    var line = sanitize(firstString(item, OLD_LINE_KEYS));
    if (!line) continue;

    var mins = firstNumber(item, OLD_MIN_KEYS);
    if (mins === null) {
      var seconds = firstNumber(item, OLD_SEC_KEYS);
      if (seconds !== null) mins = Math.round(seconds / 60);
    }
    if (mins === null || mins < 0) mins = -1;

    var dest = sanitize(firstString(item, OLD_DEST_KEYS));
    out.push({ line: line, mins: mins, dest: dest.substring(0, MAX_DEST) });
  }
  return out;
}

function parseArrivals(json, code) {
  var out = fromParades(json, code);
  if (out.length === 0) out = fromIbus(json);

  out.sort(function (a, b) {
    if (a.mins < 0 && b.mins < 0) return 0;
    if (a.mins < 0) return 1;        // no estimate: last, not first
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
  var stop = findStop(json, code);
  if (stop) return sanitize(stop.nom_parada);

  var raw = listOf(json && json.data && json.data.ibus);
  return raw.length ? sanitize(firstString(raw[0], NAME_KEYS)) : '';
}

// Everything travels in one string, and the watch keeps a fixed number of
// arrivals, so the budget is spent per line rather than first come first
// served: one busy line with a long tail of buses used to push every other
// line's second bus off the end.
function encodeArrivals(arrivals) {
  var parts = [];
  var length = 0;
  var perLine = {};

  for (var i = 0; i < arrivals.length; i++) {
    var a = arrivals[i];
    var key = '#' + a.line;
    var seen = (perLine[key] || 0) + 1;
    if (seen > MAX_PER_LINE) continue;

    var record = a.line + '|' + a.mins + '|' + a.dest + ';';
    if (length + record.length > MAX_PAYLOAD) break;

    perLine[key] = seen;
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
