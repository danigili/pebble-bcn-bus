/*
 * Exercises the pure phone-side logic without a watch, a phone or the TMB
 * API. Run with: node tools/test-pkjs.js
 */

var TMB = require('../src/pkjs/tmb.js');
var CONFIG = require('../src/pkjs/config.js');

var failures = 0;
var checks = 0;

function check(name, actual, expected) {
  checks++;
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a === b) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + '\n         expected ' + b + '\n         actual   ' + a);
  }
}

function truthy(name, value) {
  checks++;
  if (value) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name);
  }
}

console.log('\nparseArrivals');

// The live answer, copied from the endpoint itself. One entry per bus, the
// waiting time already worked out, and no stop name anywhere in it.
var live = { status: 'success', data: { ibus: [
  { destination: 'Can Marcet', line: 'V23', routeId: '2230',
    't-in-min': 5, 't-in-s': 323, 'text-ca': '5 min' },
  { destination: 'Montbau', line: 'V21', routeId: '2210',
    't-in-min': 9, 't-in-s': 596, 'text-ca': '9 min' }
] } };

check('the live shape is read as it comes', TMB.parseArrivals(live, '365'),
      [{ line: 'V23', mins: 5, dest: 'Can Marcet' },
       { line: 'V21', mins: 9, dest: 'Montbau' }]);
check('the line is the one on the stop sign, not routeId',
      TMB.parseArrivals(live, '365')[0].line, 'V23');
// 596 seconds is 9.93 minutes. TMB says nine, and so does its own text.
check('the minutes are the service own, not recomputed from the seconds',
      TMB.parseArrivals(live, '365')[1].mins, 9);
check('seconds stand in only when minutes are missing',
      TMB.parseArrivals({ data: { ibus: [{ line: 'H6', 't-in-s': 200 }] } },
                        '365')[0].mins, 3);
check('no stop name comes with it', TMB.pickStopName(live, '365'), '');

// The shape the service really answers with, kept verbatim from a live
// response so the parser is tested against the thing and not a sketch of it.
var ibus = {
  timestamp: 1744273964116,
  parades: [{
    codi_parada: '108',
    nom_parada: 'Pl Espanya - FGC',
    linies_trajectes: [{
      id_operador: 2,
      transit_namespace: 'bus',
      codi_linia: '212',
      nom_linia: 'H12',
      id_sentit: 2,
      codi_trajecte: '2121',
      desti_trajecte: 'Gornal',
      propers_busos: [
        { temps_arribada: 1744274012000, id_bus: 3673 },
        { temps_arribada: 1744274863000, id_bus: 8531 }
      ]
    }]
  }]
};

var arrivals = TMB.parseArrivals(ibus, '108');
check('every bus gets its own row, not every line', arrivals.length, 2);
check('waiting times come from the absolute timestamps',
      arrivals.map(function (a) { return a.mins; }), [1, 15]);
check('the line is the name on the stop sign, not the internal code',
      arrivals[0].line, 'H12');
check('destination read from desti_trajecte', arrivals[0].dest, 'Gornal');
check('the stop name comes from nom_parada',
      TMB.pickStopName(ibus, '108'), 'Pl Espanya - FGC');

var twoLines = {
  timestamp: 1000000,
  parades: [{
    codi_parada: '366',
    linies_trajectes: [
      { nom_linia: '59', desti_trajecte: 'Poble Sec',
        propers_busos: [{ temps_arribada: 1000000 + 12 * 60000 }] },
      { nom_linia: 'V15', desti_trajecte: 'Barceloneta',
        propers_busos: [{ temps_arribada: 1000000 + 3 * 60000 }] }
    ]
  }]
};
check('sorted by waiting time across lines',
      TMB.parseArrivals(twoLines, '366').map(function (a) { return a.line; }),
      ['V15', '59']);

check('the right stop is picked out of the list',
      TMB.parseArrivals({ timestamp: 0, parades: [
        { codi_parada: '111', linies_trajectes: [
          { nom_linia: 'H6', propers_busos: [{ temps_arribada: 60000 }] } ] },
        { codi_parada: '366', linies_trajectes: [
          { nom_linia: 'D20', propers_busos: [{ temps_arribada: 60000 }] } ] }
      ] }, '366')[0].line, 'D20');

// A bus the service still lists after its predicted minute has passed is
// pulling in, not running backwards.
check('an overdue bus is arriving, not negative',
      TMB.parseArrivals({ timestamp: 500000, parades: [{ codi_parada: '1',
        linies_trajectes: [{ nom_linia: 'H8',
          propers_busos: [{ temps_arribada: 480000 }] }] }] }, '1')[0].mins, 0);

check('falls back to the phone clock when the response carries no timestamp',
      TMB.parseArrivals({ parades: [{ codi_parada: '1', linies_trajectes: [
        { nom_linia: 'H8', propers_busos: [
          { temps_arribada: Date.now() + 5 * 60000 } ] } ] }] }, '1')[0].mins, 5);

check('a bus with no arrival time is dropped',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
        linies_trajectes: [{ nom_linia: 'H8',
          propers_busos: [{ id_bus: 3673 }] }] }] }, '1').length, 0);

check('a line with nothing coming shows nothing',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
        linies_trajectes: [{ nom_linia: 'H8' }] }] }, '1').length, 0);

check('codi_linia stands in when the line has no name',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
        linies_trajectes: [{ codi_linia: '212',
          propers_busos: [{ temps_arribada: 60000 }] }] }] }, '1')[0].line, '212');

check('trajectes with no line at all are dropped',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
        linies_trajectes: [{ propers_busos: [{ temps_arribada: 60000 }] }] }] },
        '1').length, 0);

check('a missing destination is empty, not undefined',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
        linies_trajectes: [{ nom_linia: 'H8',
          propers_busos: [{ temps_arribada: 60000 }] }] }] }, '1')[0].dest, '');

// Reading a live response is not possible from a build machine, so the
// parser takes the answer in whatever of these shapes it arrives.
check('arrival times quoted as strings still count',
      TMB.parseArrivals({ timestamp: '1744273964116', parades: [{
        codi_parada: '108', linies_trajectes: [{ nom_linia: 'H12',
          propers_busos: [{ temps_arribada: '1744274012000' }] }] }] },
        '108')[0].mins, 1);

check('epochs in seconds are read as seconds',
      TMB.parseArrivals({ timestamp: 1744273964, parades: [{
        codi_parada: '108', linies_trajectes: [{ nom_linia: 'H12',
          propers_busos: [{ temps_arribada: 1744274612 }] }] }] },
        '108')[0].mins, 11);

check('a response wrapped in a data envelope still parses',
      TMB.parseArrivals({ timestamp: 0, data: { parades: [{
        codi_parada: '108', linies_trajectes: [{ nom_linia: 'H12',
          propers_busos: [{ temps_arribada: 8 * 60000 }] }] }] } },
        '108')[0].mins, 8);

// iBus lists a bus, not a line: when it is tracking two of the same line,
// the line comes back twice and both are kept.
var twice = TMB.parseArrivals({ data: { ibus: [
  { line: 'V23', 't-in-min': 5, destination: 'Can Marcet' },
  { line: 'V21', 't-in-min': 9, destination: 'Montbau' },
  { line: 'V23', 't-in-min': 21, destination: 'Can Marcet' }
] } }, '365');
check('a line tracked twice arrives twice',
      twice.map(function (a) { return a.line + ':' + a.mins; }),
      ['V23:5', 'V21:9', 'V23:21']);
check('an entry with no time at all sorts last, as -1',
      TMB.parseArrivals({ data: { ibus: [
        { line: 'V15' }, { line: 'V23', 't-in-min': 5 } ] } }, '365')[1].mins,
      -1);

// Every bus inside propers_busos counts, however many there are: this is
// where a line's second bus lives.
var threeDeep = TMB.parseArrivals({ timestamp: 0, parades: [{
  codi_parada: '365',
  linies_trajectes: [{ nom_linia: 'V31', desti_trajecte: 'Pont del Treball',
    propers_busos: [
      { temps_arribada: 8 * 60000, id_bus: 1 },
      { temps_arribada: 23 * 60000, id_bus: 2 },
      { temps_arribada: 41 * 60000, id_bus: 3 }
    ] }]
}] }, '365');
check('every bus inside a line comes out',
      threeDeep.map(function (a) { return a.mins; }), [8, 23, 41]);

// The same line can appear as more than one trajecte; they all belong to it.
check('a line split across trajectes keeps all its buses',
      TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '365',
        linies_trajectes: [
          { nom_linia: 'V31', propers_busos: [{ temps_arribada: 8 * 60000 }] },
          { nom_linia: 'V31', propers_busos: [{ temps_arribada: 23 * 60000 }] }
        ] }] }, '365').length, 2);

check('empty response is handled', TMB.parseArrivals({}, '366'), []);
check('null response is handled', TMB.parseArrivals(null, '366'), []);
check('a stop the answer does not mention yields nothing',
      TMB.parseArrivals({ timestamp: 0, parades: [] }, '366'), []);
check('no name for a stop that is not there',
      TMB.pickStopName({ timestamp: 0, parades: [] }, '366'), '');

console.log('\nseparators');

check('pipes and semicolons never survive in a field',
      TMB.sanitize('A|B;C'), 'A/B/C');

var dirty = TMB.parseArrivals({ timestamp: 0, parades: [{ codi_parada: '1',
  linies_trajectes: [{ nom_linia: 'H8', desti_trajecte: 'Pl|Espanya;Nord',
    propers_busos: [{ temps_arribada: 2 * 60000 }] }] }] }, '1');
check('a destination cannot break the encoding', dirty[0].dest, 'Pl/Espanya/Nord');
check('encoded record stays parseable',
      TMB.encodeArrivals(dirty), 'H8|2|Pl/Espanya/Nord;');

console.log('\nencode / parse round trip');

var stops = [{ code: '366', name: 'Casa' }, { code: '1122', name: 'Feina' }];
check('stops encode', TMB.encodeStops(stops), '366|Casa;1122|Feina;');

// Nearby stops carry a third field, whole metres, for the list to show.
check('a distance travels with a nearby stop',
      TMB.encodeStops([{ code: '366', name: 'Pl Catalunya', dist: 44.7 }]),
      '366|Pl Catalunya|45;');
check('favourites have no distance and say nothing',
      TMB.encodeStops([{ code: '366', name: 'Casa' }]).indexOf('|'),
      3);
check('the distance does not confuse reading them back',
      TMB.parseStops('366|Pl Catalunya|45;'),
      [{ code: '366', name: 'Pl Catalunya' }]);
check('stops round trip', TMB.parseStops(TMB.encodeStops(stops)), stops);
check('empty payload parses to nothing', TMB.parseStops(''), []);
check('a stop with no name falls back to the code',
      TMB.parseStops('366|;'), [{ code: '366', name: '366' }]);

var many = [];
for (var i = 0; i < 200; i++) many.push({ line: 'H' + i, mins: i, dest: 'Destination name' });
truthy('a long arrivals payload is capped for the watch',
       TMB.encodeArrivals(many).length <= 900);

var hogging = [];
for (var i = 0; i < 6; i++) hogging.push({ line: 'H12', mins: i * 4, dest: 'Gornal' });
check('one line cannot spend the whole message on itself',
      TMB.encodeArrivals(hogging).split(';').filter(Boolean).length, 3);

// The watch keeps MAX_ARRIVALS of these, and a line's detail screen wants
// two of its own, so a busy stop must not spend the room on first buses.
var busy = [];
for (var i = 0; i < 14; i++) {
  busy.push({ line: 'L' + i, mins: i + 1, dest: 'Barceloneta' });
  busy.push({ line: 'L' + i, mins: i + 10, dest: 'Barceloneta' });
}
busy.sort(function (a, b) { return a.mins - b.mins; });

var records = TMB.encodeArrivals(busy).split(';').filter(Boolean).slice(0, 32);
var perLine = {};
records.forEach(function (r) {
  var key = '#' + r.split('|')[0];
  perLine[key] = (perLine[key] || 0) + 1;
});
var withTwo = Object.keys(perLine).filter(function (k) { return perLine[k] >= 2; });
check('every line at a busy stop keeps its next two', withTwo.length, 14);

console.log('\nURLs');

var auth = 'app_id=' + TMB.APP_ID + '&app_key=' + TMB.APP_KEY;
truthy('the app ships with credentials', !!TMB.APP_ID && !!TMB.APP_KEY);
check('ibus url', TMB.buildIbusUrl('366'),
      'https://api.tmb.cat/v1/ibus/stops/366?' + auth);

check('stops url', TMB.buildStopsUrl(),
      'https://api.tmb.cat/v1/transit/parades?' + auth);

console.log('\nstop index');

// The documented shape: GeoJSON, EPSG:4326, longitude first.
var geo = { type: 'FeatureCollection', totalFeatures: 3, features: [
  { type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.148751, 41.374565] },
    properties: { CODI_PARADA: 2775, NOM_PARADA: 'Pl Espanya',
                  DESC_PARADA: 'Pl. Espanya/Gran Via C.Catalanes',
                  ID_POBLACIO: 748 } },
  { type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.1687, 41.3875] },
    properties: { CODI_PARADA: 366, NOM_PARADA: 'Pl Catalunya' } },
  { type: 'Feature',
    geometry: null,
    properties: { CODI_PARADA: 999, NOM_PARADA: 'Sense posicio' } }
] };

var index = TMB.parseStopIndex(geo);
check('a stop keeps its code, its name and where it is', index[0],
      { c: '2775', n: 'Pl Espanya', y: 41.374565, x: 2.148751 });
check('stops with no geometry are dropped', index.length, 2);
check('the code comes through as a string, as the watch wants it',
      typeof index[1].c, 'string');

check('DESC_PARADA stands in when a stop has no short name',
      TMB.parseStopIndex({ features: [{ geometry: { coordinates: [2, 41] },
        properties: { CODI_PARADA: 1, DESC_PARADA: 'Gran Via/Entenca' } }] })[0].n,
      'Gran Via/Entenca');

console.log('\nnearestStops');

var near = TMB.nearestStops(index, 41.3874, 2.1686, 500, 16);
check('only what is within reach', near.length, 1);
check('and it is the right one', near[0].code, '366');
truthy('carrying how far it is', near[0].dist < 20);

var wide = TMB.nearestStops(index, 41.3874, 2.1686, 3000, 16);
check('widen the radius and the rest appear, nearest first',
      wide.map(function (s) { return s.code; }), ['366', '2775']);
truthy('the far one is a couple of kilometres out',
       wide[1].dist > 2000 && wide[1].dist < 2400);

check('a limit is a limit', TMB.nearestStops(index, 41.3874, 2.1686, 3000, 1).length, 1);
check('nothing in range is no stops, not an error',
      TMB.nearestStops(index, 41.0, 2.0, 500, 16), []);
check('an empty index is handled', TMB.nearestStops([], 41.3874, 2.1686, 500, 16), []);

console.log('\nsettings page');

var html = CONFIG.buildConfigPage({ lang: 'es', radius: 700 },
                                  [{ code: '366', name: 'Casa' }]);
truthy('page closes back into the app', html.indexOf('pebblejs://close#') > 0);
truthy('existing favourites are baked in', html.indexOf('"366"') > 0);
truthy('the page asks for no credentials', html.indexOf('app_key') < 0);
truthy('fits comfortably in a data: URI', encodeURIComponent(html).length < 60000);
truthy('no stray closing script tag breaks the page',
       html.split('<script>').length === html.split('<\/script>').length);

// Pull returnUrl() straight out of the generated page and run it: the
// emulator sends the page a return_to parameter, a real watch does not.
var returnUrlSource = /function returnUrl\(\)\{[^}]*\}/.exec(html);
truthy('the page carries a returnUrl helper', !!returnUrlSource);

var callReturnUrl = new Function('location',
    returnUrlSource[0] + ' return returnUrl();');

check('a real watch closes through the pebblejs scheme',
      callReturnUrl({ href: 'data:text/html,%3Chtml%3E' }),
      'pebblejs://close#');

check('the emulator closes through the URL it supplies',
      callReturnUrl({ href: 'http://localhost:8080/config?return_to=' +
                            encodeURIComponent('http://localhost:9999/close#') }),
      'http://localhost:9999/close#');

console.log('\n' + (failures === 0
  ? checks + ' checks passed'
  : failures + ' of ' + checks + ' checks FAILED'));
process.exit(failures === 0 ? 0 : 1);
