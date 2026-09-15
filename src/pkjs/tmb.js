/*
 * Talking to the TMB API, and packing the answers into the compact strings
 * the watch parses. Every function here is pure, so tools/test-pkjs.js can
 * exercise them without a phone or a watch.
 *
 * Two arrival shapes are read. /itransit/bus/parades nests the buses inside
 * each line of each stop:
 *
 *   { timestamp, parades: [ { codi_parada, nom_parada, linies_trajectes: [
 *       { nom_linia, desti_trajecte, propers_busos: [ { temps_arribada } ] }
 *     ] } ] }
 *
 * Its times are absolute epoch milliseconds, measured against the response's
 * own timestamp rather than the phone's clock. /ibus/stops is flat, one
 * entry per bus, with the waiting time already worked out.
 */

var BASE = 'https://api.tmb.cat/v1';

var APP_ID  = 'd4ef8b79';
var APP_KEY = '71f41c220aa7bcada2565b4ce0dd4ddd';

// A pair the user entered on the settings page, for when the ones above stop
// working. Both or neither: half a pair authenticates nothing.
var s_id = '';
var s_key = '';

function useCredentials(id, key) {
  id = String(id || '').trim();
  key = String(key || '').trim();
  s_id = (id && key) ? id : '';
  s_key = (id && key) ? key : '';
}

var MAX_PAYLOAD  = 900;   // keep well inside the watch's AppMessage inbox
var MAX_DEST     = 24;
var MAX_PER_LINE = 3;     // nobody is waiting for the fourth bus of one line

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
  return 'app_id=' + encodeURIComponent(s_id || APP_ID) +
         '&app_key=' + encodeURIComponent(s_key || APP_KEY);
}

// A stop code as the service knows it: digits only, and without the zeros a
// stop sign pads it out with. "0828" is 828. All zeros keeps one.
function stopCode(text) {
  var digits = String(text === undefined || text === null ? '' : text)
      .replace(/[^0-9]/g, '')
      .replace(/^0+(?=.)/, '');
  return digits;
}

// Every bus coming to a stop, grouped by line.
function buildTimesUrl(stopCode) {
  return BASE + '/itransit/bus/parades/' + encodeURIComponent(stopCode) +
         '?' + auth();
}

// Every bus stop TMB runs, as GeoJSON. There is no way to ask for the ones
// near a point: the filter parameter matches properties, not geometry.
function buildStopsUrl() {
  return BASE + '/transit/parades?' + auth();
}

// Every bus line TMB runs, which is where the line colours live.
function buildLinesUrl() {
  return BASE + '/transit/linies/bus?' + auth();
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

// 1e9 seconds is 2001 and 1e11 is the year 5138: a number in that band is
// an epoch in seconds, anything outside it is taken as it comes.
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

// The answer is a list, so pick the stop asked for, or whatever came back.
function findStop(json, code) {
  var parades = paradesOf(json);
  for (var i = 0; i < parades.length; i++) {
    if (parades[i] && String(parades[i].codi_parada) === String(code)) {
      return parades[i];
    }
  }
  return parades[0] || null;
}

// Rounded down, the way TMB rounds: its own t-in-min calls 596 seconds nine
// minutes, not ten.
function minutesUntil(arrival, now) {
  var at = toMillis(arrival);
  if (at === null) return null;
  var mins = Math.floor((at - now) / 60000);
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
    // internal number for it ("212").
    var line = sanitize(trip.nom_linia || trip.codi_linia);
    if (!line) continue;

    var dest = sanitize(trip.desti_trajecte).substring(0, MAX_DEST);
    var buses = listOf(trip.propers_busos);

    // The line list only covers the ones TMB operates.
    var amb = (trip.transit_namespace === 'amb');

    // One row per bus, not per line.
    for (var j = 0; j < buses.length; j++) {
      var mins = minutesUntil(buses[j] && buses[j].temps_arribada, now);
      if (mins === null) continue;
      out.push({ line: line, mins: mins, dest: dest, amb: amb });
    }
  }
  return out;
}

// The flat shape, from /ibus/stops:
//
//   {"status":"success","data":{"ibus":[
//     {"line":"V23","routeId":"2230","destination":"Can Marcet",
//      "t-in-min":5,"t-in-s":323,"text-ca":"5 min"}]}}
//
// One entry per bus, the wait already worked out, and only the buses iBus is
// tracking — often one per line.
var IBUS_LINE_KEYS = ['line', 'nom_linia', 'route', 'routeId'];
var IBUS_MIN_KEYS  = ['t-in-min', 'tInMin', 'temps_min', 'minutes'];
var IBUS_SEC_KEYS  = ['t-in-s', 'tInS', 'temps_s', 'seconds'];
var IBUS_DEST_KEYS = ['destination', 'desti', 'desti_trajecte', 'headsign'];
var IBUS_NAME_KEYS = ['NOM_PARADA', 'nom_parada', 'nom', 'name'];

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

    var line = sanitize(firstString(item, IBUS_LINE_KEYS));
    if (!line) continue;

    // t-in-min is the service's own figure, and the one its "9 min" text
    // agrees with. Seconds only stand in when minutes are missing.
    var mins = firstNumber(item, IBUS_MIN_KEYS);
    if (mins === null) {
      var seconds = firstNumber(item, IBUS_SEC_KEYS);
      if (seconds !== null) mins = Math.floor(seconds / 60);
    }
    if (mins === null || mins < 0) mins = -1;

    var dest = sanitize(firstString(item, IBUS_DEST_KEYS));
    out.push({ line: line, mins: mins, dest: dest.substring(0, MAX_DEST) });
  }
  return out;
}

// The nested shape first, the flat one as a fallback.
// Whether the answer is about the stop that was asked for. The nested shape
// lists the stops it knows, so a code it does not know comes back with none.
// The flat shape cannot tell an unknown stop from a quiet one.
function namesStop(json, code) {
  var nested = json && (json.parades || (json.data && json.data.parades));
  if (!nested) return true;

  var parades = listOf(nested);
  for (var i = 0; i < parades.length; i++) {
    if (parades[i] && String(parades[i].codi_parada) === String(code)) {
      return true;
    }
  }
  return false;
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

// "D6001C", with or without a hash, in either case, or eight digits with
// transparency.
function normaliseHex(value) {
  var hex = String(value === undefined || value === null ? '' : value)
      .replace(/[^0-9a-fA-F]/g, '').toUpperCase();

  if (hex.length === 8) hex = hex.substring(0, 6);   // RRGGBBAA
  return (hex.length === 6) ? hex : '';
}

// The watch shows 64 colours: two bits a channel, in one byte. A colour
// travels as the two hex digits of that byte, so "E30613" goes as "F0".
function shortColor(hex) {
  var full = normaliseHex(hex);
  if (!full) return '';

  var code = 0xc0;   // the top two bits are the alpha the watch expects
  for (var i = 0; i < 3; i++) {
    var channel = parseInt(full.substr(i * 2, 2), 16);
    code |= Math.round(channel / 85) << (4 - i * 2);
  }
  var out = code.toString(16).toUpperCase();
  return (out.length < 2) ? '0' + out : out;
}

var LINE_NAME_KEYS  = ['NOM_LINIA', 'nom_linia', 'NOM', 'CODI_LINIA'];
var LINE_COLOR_KEYS = ['COLOR_LINIA', 'COLOR', 'color_linia', 'color',
                       'route_color', 'COLOR_LINIA_HEX'];

// The colour of each line, by the name written on the bus: { "V29": "..." }.
// Which property carries it is not documented, so several are tried.
function parseLineColors(json) {
  var features = listOf(json && json.features);
  var out = {};

  for (var i = 0; i < features.length; i++) {
    var props = (features[i] && features[i].properties) || {};
    var name = sanitize(firstString(props, LINE_NAME_KEYS)).toUpperCase();
    var color = shortColor(firstString(props, LINE_COLOR_KEYS));
    if (name && color) out[name] = color;
  }
  return out;
}

// The stops, kept down to what a search needs: code, name and position.
// GeoJSON, coordinates in EPSG:4326, longitude first.
function parseStopIndex(json) {
  var features = listOf(json && json.features);
  var out = [];

  for (var i = 0; i < features.length; i++) {
    var feature = features[i] || {};
    var props = feature.properties || {};

    var code = sanitize(props.CODI_PARADA);
    if (!code) continue;

    var coords = feature.geometry && feature.geometry.coordinates;
    var lon = toNumber(coords && coords[0]);
    var lat = toNumber(coords && coords[1]);
    if (lat === null || lon === null) continue;

    out.push({
      c: code,
      n: sanitize(props.NOM_PARADA || props.DESC_PARADA) || code,
      y: lat,
      x: lon
    });
  }
  return out;
}

// The stops within reach of a point, nearest first.
function nearestStops(index, lat, lon, radius, limit) {
  var out = [];

  for (var i = 0; i < index.length; i++) {
    var stop = index[i];
    var dist = haversine(lat, lon, stop.y, stop.x);
    if (dist <= radius) out.push({ code: stop.c, name: stop.n, dist: dist });
  }

  out.sort(function (a, b) { return a.dist - b.dist; });
  return out.slice(0, limit);
}

function pickStopName(json, code) {
  var stop = findStop(json, code);
  if (stop) return sanitize(stop.nom_parada);

  // The flat shape carries no stop name, so this often comes back empty.
  var raw = listOf(json && json.data && json.data.ibus);
  return raw.length ? sanitize(firstString(raw[0], IBUS_NAME_KEYS)) : '';
}

// One string with a size limit, and the watch keeps a fixed number of
// arrivals, so they go out by rank: every line's next bus, then every line's
// one after that, then the thirds. Within a rank, soonest first.
function encodeArrivals(arrivals) {
  var perLine = {};
  var ranked = [];

  for (var i = 0; i < arrivals.length; i++) {
    var key = '#' + arrivals[i].line;
    var rank = perLine[key] || 0;
    perLine[key] = rank + 1;
    if (rank >= MAX_PER_LINE) continue;   // nobody waits for a fourth
    ranked.push({ arrival: arrivals[i], rank: rank, order: i });
  }

  ranked.sort(function (a, b) {
    return (a.rank !== b.rank) ? a.rank - b.rank : a.order - b.order;
  });

  // A line's destination and colour are written once, on its first bus, and
  // left empty on the rest for the watch to fill in.
  var parts = [];
  var length = 0;
  var said = {};

  for (var j = 0; j < ranked.length; j++) {
    var a = ranked[j].arrival;
    var key = '#' + a.line;
    var known = said[key];

    var dest = (known && known.dest === a.dest) ? '' : a.dest;
    var color = (known && known.color === a.color) ? '' : (a.color || '');
    var record = a.line + '|' + a.mins + '|' + dest +
                 (color ? '|' + color : '') + ';';

    if (length + record.length > MAX_PAYLOAD) break;

    said[key] = { dest: a.dest, color: a.color };
    parts.push(record);
    length += record.length;
  }
  return parts.join('');
}

// A third field carries the distance in whole metres, where there is one.
function encodeStops(stops) {
  var parts = [];
  var length = 0;

  for (var i = 0; i < stops.length; i++) {
    var dist = toNumber(stops[i].dist);
    var record = sanitize(stops[i].code) + '|' +
                 sanitize(stops[i].name).substring(0, MAX_DEST) +
                 (dist === null ? '' : '|' + Math.round(dist)) + ';';
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
  useCredentials: useCredentials,
  sanitize: sanitize,
  stopCode: stopCode,
  buildTimesUrl: buildTimesUrl,
  buildStopsUrl: buildStopsUrl,
  buildLinesUrl: buildLinesUrl,
  parseLineColors: parseLineColors,
  normaliseHex: normaliseHex,
  shortColor: shortColor,
  parseArrivals: parseArrivals,
  namesStop: namesStop,
  parseStopIndex: parseStopIndex,
  nearestStops: nearestStops,
  pickStopName: pickStopName,
  encodeArrivals: encodeArrivals,
  encodeStops: encodeStops,
  parseStops: parseStops,
  haversine: haversine
};

if (typeof module !== 'undefined' && module.exports) module.exports = TMB;
