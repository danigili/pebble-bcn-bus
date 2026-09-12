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

var ibus = { data: { ibus: [
  { line: '59',  routeId: '59',  't-in-min': 12, 't-in-s': 740, 'text-ca': '12 min', desti: 'Poble Sec' },
  { line: 'H12', routeId: 'H12', 't-in-min': 3,  't-in-s': 190, 'text-ca': '3 min',  destination: 'Gorg' },
  { line: 'V15', routeId: 'V15', 't-in-min': 0,  't-in-s': 20,  'text-ca': 'Arribant' }
] } };

var arrivals = TMB.parseArrivals(ibus);
check('sorted by waiting time', arrivals.map(function (a) { return a.line; }),
      ['V15', 'H12', '59']);
check('minutes preserved', arrivals.map(function (a) { return a.mins; }), [0, 3, 12]);
check('destination found under "destination"', arrivals[1].dest, 'Gorg');
check('destination found under "desti"', arrivals[2].dest, 'Poble Sec');
check('missing destination is empty, not undefined', arrivals[0].dest, '');

// A field that holds "5 min" is the waiting time again, not a destination.
check('time-like text rejected as a destination',
      TMB.parseArrivals({ data: { ibus: [
        { line: 'D20', 't-in-min': 5, destination: '5 min' } ] } })[0].dest, '');

check('falls back to t-in-s when minutes are absent',
      TMB.parseArrivals({ data: { ibus: [
        { line: 'H6', 't-in-s': 200 } ] } })[0].mins, 3);

check('unknown waiting time becomes -1',
      TMB.parseArrivals({ data: { ibus: [{ line: 'H6' }] } })[0].mins, -1);

check('entries with no line are dropped',
      TMB.parseArrivals({ data: { ibus: [{ 't-in-min': 4 }] } }).length, 0);

check('empty response is handled', TMB.parseArrivals({}), []);
check('null response is handled', TMB.parseArrivals(null), []);

check('a single object rather than an array still parses',
      TMB.parseArrivals({ data: { ibus: { line: 'V21', 't-in-min': 7 } } }).length, 1);

console.log('\nseparators');

check('pipes and semicolons never survive in a field',
      TMB.sanitize('A|B;C'), 'A/B/C');

var dirty = TMB.parseArrivals({ data: { ibus: [
  { line: 'H8', 't-in-min': 2, destination: 'Pl|Espanya;Nord' } ] } });
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
