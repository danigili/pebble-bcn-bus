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

// A live answer from /itransit/bus/parades/1178, kept verbatim: three lines,
// two buses each, one of them run by another AMB operator.
var live = {"timestamp":1789244386957,"parades":[{"codi_parada":"1178","nom_parada":"Pont del Treball - Santander","linies_trajectes":[{"id_operador":2,"transit_namespace":"bus","codi_linia":229,"nom_linia":"V29","id_sentit":2,"codi_trajecte":"2291","desti_trajecte":"Diagonal Mar","propers_busos":[{"temps_arribada":1789244569000,"id_bus":7812,"info_bus":{"accessibilitat":{"estat_rampa":"SENSE_INCIDENCIA"}}},{"temps_arribada":1789245737000,"id_bus":7813,"info_bus":{"accessibilitat":{"estat_rampa":"SENSE_INCIDENCIA"}}}]},{"id_operador":2,"transit_namespace":"bus","codi_linia":231,"nom_linia":"V31","id_sentit":2,"codi_trajecte":"2311","desti_trajecte":"Fòrum","propers_busos":[{"temps_arribada":1789245059000,"id_bus":4636},{"temps_arribada":1789246199000,"id_bus":4637}]},{"id_operador":6,"transit_namespace":"amb","codi_linia":"B24","nom_linia":"B24","id_sentit":2,"codi_trajecte":"B24-Badalona","desti_trajecte":"Badalona","propers_busos":[{"temps_arribada":1789245773000},{"temps_arribada":1789246746000}]}]}]};

check('the live answer, line by line and bus by bus',
      TMB.parseArrivals(live, '1178').map(function (a) {
        return a.line + ':' + a.mins;
      }),
      ['V29:3', 'V31:11', 'V29:22', 'B24:23', 'V31:30', 'B24:39']);
check('every line keeps both of its buses',
      TMB.parseArrivals(live, '1178').filter(function (a) {
        return a.line === 'V31';
      }).length, 2);
check('the destination comes from desti_trajecte',
      TMB.parseArrivals(live, '1178')[0].dest, 'Diagonal Mar');
check('the stop names itself', TMB.pickStopName(live, '1178'),
      'Pont del Treball - Santander');
// 1350043 ms is 22 minutes and a half. TMB would call that 22.
check('a waiting time is rounded down, not up',
      TMB.parseArrivals(live, '1178')[2].mins, 22);
check('a line run by another AMB operator is a line like any other',
      TMB.parseArrivals(live, '1178')[3].line, 'B24');
// TMB's line list has only TMB's lines, so this is how the others are known.
check('and is marked as the AMB\'s, since its colour is not in TMB\'s list',
      TMB.parseArrivals(live, '1178')[3].amb, true);
check('while a TMB line is not', TMB.parseArrivals(live, '1178')[0].amb, false);

// The older /ibus/stops answer, copied from that endpoint: one entry per
// line, the waiting time already worked out, and no stop name in it. Still
// read, as a fallback.
var flat = { status: 'success', data: { ibus: [
  { destination: 'Can Marcet', line: 'V23', routeId: '2230',
    't-in-min': 5, 't-in-s': 323, 'text-ca': '5 min' },
  { destination: 'Montbau', line: 'V21', routeId: '2210',
    't-in-min': 9, 't-in-s': 596, 'text-ca': '9 min' }
] } };

check('the flat shape is read as it comes', TMB.parseArrivals(flat, '365'),
      [{ line: 'V23', mins: 5, dest: 'Can Marcet' },
       { line: 'V21', mins: 9, dest: 'Montbau' }]);
check('the line is the one on the stop sign, not routeId',
      TMB.parseArrivals(flat, '365')[0].line, 'V23');
// 596 seconds is 9.93 minutes. TMB says nine, and so does its own text.
check('the minutes are the service own, not recomputed from the seconds',
      TMB.parseArrivals(flat, '365')[1].mins, 9);
check('seconds stand in only when minutes are missing',
      TMB.parseArrivals({ data: { ibus: [{ line: 'H6', 't-in-s': 200 }] } },
                        '365')[0].mins, 3);
check('no stop name comes with it', TMB.pickStopName(flat, '365'), '');

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
// 47884 ms is 48 seconds: that bus is pulling in, not a minute away.
check('waiting times come from the absolute timestamps',
      arrivals.map(function (a) { return a.mins; }), [0, 14]);
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

// Half a minute past five, so the milliseconds this test takes to run
// cannot round it down to four.
check('falls back to the phone clock when the response carries no timestamp',
      TMB.parseArrivals({ parades: [{ codi_parada: '1', linies_trajectes: [
        { nom_linia: 'H8', propers_busos: [
          { temps_arribada: Date.now() + 5.5 * 60000 } ] } ] }] }, '1')[0].mins,
      5);

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
        '108')[0].mins, 0);

check('epochs in seconds are read as seconds',
      TMB.parseArrivals({ timestamp: 1744273964, parades: [{
        codi_parada: '108', linies_trajectes: [{ nom_linia: 'H12',
          propers_busos: [{ temps_arribada: 1744274612 }] }] }] },
        '108')[0].mins, 10);

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

// A code the service has never heard of comes back with no stop in it, which
// is not the same as a stop with nothing due.
truthy('the answer names the stop that was asked for',
       TMB.namesStop(live, '1178'));
truthy('a code the answer does not mention is not a stop',
       !TMB.namesStop(live, '99999'));
truthy('nor is one that comes back with an empty list',
       !TMB.namesStop({ timestamp: 1, parades: [] }, '99999'));
truthy('the flat shape cannot tell, so it does not claim to',
       TMB.namesStop({ data: { ibus: [] } }, '99999'));
truthy('and neither can an answer with nothing in it',
       TMB.namesStop({}, '99999'));

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

console.log('\nline colours');

var palette = TMB.parseLineColors({ features: [
  { properties: { NOM_LINIA: 'V29', COLOR_LINIA: '#E30613' } },
  { properties: { NOM_LINIA: 'B24', COLOR_LINIA: 'ffd800' } },
  { properties: { NOM_LINIA: 'H12', COLOR: '008ec1ff' } },
  { properties: { NOM_LINIA: 'X1' } },
  { properties: { COLOR_LINIA: 'D6001C' } }
] });
check('a colour per line, by the name on the bus, as a short code', palette,
      { V29: 'F0', B24: 'FC', H12: 'CA' });
check('red stays red', TMB.shortColor('#E30613'), 'F0');
check('yellow stays yellow', TMB.shortColor('FFD800'), 'FC');
check('black is a code too, not an absence', TMB.shortColor('000000'), 'C0');
check('white as well', TMB.shortColor('FFFFFF'), 'FF');
check('no colour, no code', TMB.shortColor('blau'), '');
check('a hash makes no difference', TMB.normaliseHex('#E30613'), 'E30613');
check('nor does the case', TMB.normaliseHex('e30613'), 'E30613');
check('eight digits are a colour with transparency',
      TMB.normaliseHex('008ec1ff'), '008EC1');
check('anything else is no colour at all', TMB.normaliseHex('blau'), '');
check('and so is nothing', TMB.normaliseHex(undefined), '');

// The colours a line falls back on when TMB's list does not carry it. The
// rule lives in index.js, so this is the shape of it, checked here where
// the codes are: night first, then whoever runs it.
check('the night blue and the AMB yellow are different codes',
      TMB.shortColor('1B3D8F') === TMB.shortColor('FFD800'), false);
check('night blue', TMB.shortColor('1B3D8F'), 'C6');
check('AMB yellow', TMB.shortColor('FFD800'), 'FC');

check('a colour travels as a fourth field, two characters wide',
      TMB.encodeArrivals([{ line: 'V29', mins: 3, dest: 'Diagonal Mar',
                            color: 'F0' }]),
      'V29|3|Diagonal Mar|F0;');
check('a line with no colour simply leaves it off',
      TMB.encodeArrivals([{ line: 'V29', mins: 3, dest: 'Diagonal Mar' }]),
      'V29|3|Diagonal Mar;');

// The colours cost seven characters a record, so a busy stop has to still
// fit every line's next two buses in the message.
var busy = [];
for (var b = 0; b < 15; b++) {
  busy.push({ line: 'L' + b, mins: b + 1, dest: 'Pont del Treball Digne',
              color: 'F0' });
  busy.push({ line: 'L' + b, mins: b + 10, dest: 'Pont del Treball Digne',
              color: 'F0' });
}
busy.sort(function (x, y) { return x.mins - y.mins; });

var painted = TMB.encodeArrivals(busy).split(';').filter(Boolean).slice(0, 32);
var seen = {};
painted.forEach(function (r) {
  var key = '#' + r.split('|')[0];
  seen[key] = (seen[key] || 0) + 1;
});
check('colours do not cost a line its second bus',
      Object.keys(seen).filter(function (k) { return seen[k] >= 2; }).length, 15);

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

// The settings page can replace them, for the day they stop working.
TMB.useCredentials('mine', 'secret');
truthy('a pair from the settings page is used instead',
       TMB.buildTimesUrl('366').indexOf('app_id=mine&app_key=secret') > 0);
truthy('and on every call, not just that one',
       TMB.buildStopsUrl().indexOf('app_id=mine&app_key=secret') > 0);

TMB.useCredentials('  spaced  ', '  out  ');
truthy('typed with spaces around them, they still work',
       TMB.buildTimesUrl('366').indexOf('app_id=spaced&app_key=out') > 0);

TMB.useCredentials('mine', '');
truthy('half a pair authenticates nothing, so the built-in ones stand',
       TMB.buildTimesUrl('366').indexOf(auth) > 0);

TMB.useCredentials('', '');
truthy('and clearing them goes back to the built-in ones',
       TMB.buildTimesUrl('366').indexOf(auth) > 0);
check('times url', TMB.buildTimesUrl('366'),
      'https://api.tmb.cat/v1/itransit/bus/parades/366?' + auth);

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

var html = CONFIG.buildConfigPage({ app_id: 'a', app_key: 'b', lang: 'es',
                                    radius: 700 },
                                  [{ code: '366', name: 'Casa' }]);
truthy('page closes back into the app', html.indexOf('pebblejs://close#') > 0);
truthy('existing favourites are baked in', html.indexOf('"366"') > 0);
truthy('the page offers the credential fields', html.indexOf('app_key') > 0);
truthy('and fills them with whatever is set', html.indexOf('"a"') > 0);
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
