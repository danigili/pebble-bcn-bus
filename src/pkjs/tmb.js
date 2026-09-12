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
 * Two shapes are read. The one the service actually answers with is flat —
 * { data: { ibus: [ one entry per bus ] } }, with the waiting time already
 * worked out — and is tried first. The one TMB documents nests the buses
 * inside each line of each stop, and is tried second in case an endpoint
 * somewhere answers that way; it is where temps_arribada and propers_busos
 * come in, and those are absolute times, so there a wait is a subtraction
 * against the response's own timestamp rather than the phone's clock.
 *
 * The stops endpoint is a different matter: it is GeoJSON, documented, and
 * has no way to ask for what is near a point. See buildStopsUrl.
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

// This is the one that answers with every bus it knows is coming, grouped
// by line. The older /ibus/stops/<code> gives the same stop but only the
// nearest bus of each line, which is no use to a screen whose whole job is
// the one after that.
function buildTimesUrl(stopCode) {
  return BASE + '/itransit/bus/parades/' + encodeURIComponent(stopCode) +
         '?' + auth();
}

// Every bus stop TMB runs, as GeoJSON. There is no way to ask for the ones
// near a point: the filter parameter matches properties, not geometry. So
// the whole list is fetched, boiled down to a coordinate each, and kept on
// the phone — stops do not move — and the nearby search happens here.
function buildStopsUrl() {
  return BASE + '/transit/parades?' + auth();
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

// What the service actually answers with, read off the live endpoint:
//
//   {"status":"success","data":{"ibus":[
//     {"line":"V23","routeId":"2230","destination":"Can Marcet",
//      "t-in-min":5,"t-in-s":323,"text-ca":"5 min"}]}}
//
// One entry per bus, with the waiting time already worked out. "line" is
// what the stop sign says ("V23"); "routeId" is TMB's internal number for
// it ("2230"), which is no use to anyone waiting. iBus reports the buses it
// is actually tracking, so a line appears once per bus on its way — often
// just the one.
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

    // t-in-min is the service's own figure and the one its "9 min" text
    // agrees with, so it wins. Recomputing it from t-in-s would round 596
    // seconds up to ten minutes and disagree with every other screen TMB
    // puts that bus on. Seconds only stand in when minutes are missing.
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

// The shape /itransit/bus/parades answers with first, since that is what we
// ask for. The flat one from /ibus/stops is kept as a fallback: same stop,
// same buses, one per line.
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

// The stops, kept down to what a search needs: a code, something to call
// it, and where it is. A couple of thousand of these live in the phone's
// storage, so every field that is not one of those three is dropped.
//
// The documented shape is GeoJSON, with the coordinates in EPSG:4326 and
// longitude first.
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

  // The live answer carries no stop name at all, so this usually comes back
  // empty and the name the watch already has is the one that shows.
  var raw = listOf(json && json.data && json.data.ibus);
  return raw.length ? sanitize(firstString(raw[0], IBUS_NAME_KEYS)) : '';
}

// Everything travels in one string with a size limit, and the watch keeps a
// fixed number of arrivals, so what gets left out matters.
//
// Sorted purely by time, the message fills up with whatever is soonest, and
// at a stop with a dozen lines that is the first bus of each of them plus
// the tail of the two or three earliest. Every other line loses its second
// bus, which is exactly what a line's detail screen goes looking for.
//
// So they go out by rank instead: every line's next bus, then every line's
// one after that, then the thirds. Within a rank the soonest goes first,
// which is the order they arrive in.
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

  var parts = [];
  var length = 0;

  for (var j = 0; j < ranked.length; j++) {
    var a = ranked[j].arrival;
    var record = a.line + '|' + a.mins + '|' + a.dest + ';';
    if (length + record.length > MAX_PAYLOAD) break;
    parts.push(record);
    length += record.length;
  }
  return parts.join('');
}

// A third field carries how far away the stop is, in whole metres, for the
// ones that know. Favourites have no distance and simply leave it off; the
// watch reads what is there and ignores what is not.
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
  sanitize: sanitize,
  buildTimesUrl: buildTimesUrl,
  buildStopsUrl: buildStopsUrl,
  parseArrivals: parseArrivals,
  parseStopIndex: parseStopIndex,
  nearestStops: nearestStops,
  pickStopName: pickStopName,
  encodeArrivals: encodeArrivals,
  encodeStops: encodeStops,
  parseStops: parseStops,
  haversine: haversine
};

if (typeof module !== 'undefined' && module.exports) module.exports = TMB;
