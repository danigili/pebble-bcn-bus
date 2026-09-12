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

// Some deployments answer with the older flat shape, where the waiting time
// comes already worked out.
var legacy = TMB.parseArrivals({ data: { ibus: [
  { routeId: '59', 't-in-min': 12, desti: 'Poble Sec' },
  { routeId: 'H12', 't-in-s': 190, destination: 'Gorg' },
  { routeId: 'V15' }
] } }, '366');
check('the older shape is read when the current one finds nothing',
      legacy.map(function (a) { return a.line; }), ['H12', '59', 'V15']);
check('and its waiting times come through', legacy[0].mins, 3);
check('with no estimate at all sorting last, as -1', legacy[2].mins, -1);
check('the stop name too, from the older shape',
      TMB.pickStopName({ data: { ibus: [{ NOM_PARADA: 'Pl Espanya' }] } }, '366'),
      'Pl Espanya');

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
check('stops round trip', TMB.parseStops(TMB.encodeStops(stops)), stops);
check('empty payload parses to nothing', TMB.parseStops(''), []);
check('a stop with no name falls back to the code',
      TMB.parseStops('366|;'), [{ code: '366', name: '366' }]);

var many = [];
for (var i = 0; i < 200; i++) many.push({ line: 'H' + i, mins: i, dest: 'Destination name' });
truthy('a long arrivals payload is capped for the watch',
       TMB.encodeArrivals(many).length <= 900);

console.log('\nURLs');

var auth = 'app_id=' + TMB.APP_ID + '&app_key=' + TMB.APP_KEY;
truthy('the app ships with credentials', !!TMB.APP_ID && !!TMB.APP_KEY);
check('ibus url', TMB.buildIbusUrl('366'),
      'https://api.tmb.cat/v1/ibus/stops/366?' + auth);

var urls = TMB.buildNearbyUrls(41.3874, 2.1686, 500);
check('two nearby strategies are tried', urls.length, 2);
truthy('first strategy is the distance filter', urls[0].indexOf('DWITHIN') > 0);
truthy('second strategy is the bounding box', urls[1].indexOf('BBOX') > 0);
truthy('credentials travel on both', urls[1].indexOf(auth) > 0);

console.log('\nparseNearby');

var geo = { features: [
  { properties: { CODI_PARADA: '1122', NOM_PARADA: 'Lluny' },
    geometry: { coordinates: [2.1750, 41.3900] } },
  { properties: { CODI_PARADA: '366', NOM_PARADA: 'A prop' },
    geometry: { coordinates: [2.1687, 41.3875] } },
  { properties: { NOM_PARADA: 'Sense codi' },
    geometry: { coordinates: [2.1687, 41.3875] } }
] };

var nearby = TMB.parseNearby(geo, 41.3874, 2.1686);
check('sorted by distance', nearby.map(function (s) { return s.code; }), ['366', '1122']);
check('stops without a code are dropped', nearby.length, 2);
truthy('nearest stop is a few metres away', nearby[0].dist < 50);

check('lowercase property names also work',
      TMB.parseNearby({ features: [ { properties: { codi: '99', nom: 'Test' },
        geometry: { coordinates: [2.1686, 41.3874] } } ] }, 41.3874, 2.1686)[0].name,
      'Test');

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
