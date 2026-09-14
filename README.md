# BCN Bus

## Store listing

Copy what follows into the app store entry.

---

**BCN Bus — live Barcelona bus times**

Real-time bus arrivals for Barcelona on your Pebble. See how long until the
next bus at any TMB stop without taking your phone out.

- **Preferides** — keep the stops you use every day and open them in one press.
- **A prop meu** — find bus stops near you by GPS, nearest first, with the
  distance in metres.
- **Cercar per codi** — type the stop code printed on the bus stop sign.

Open a stop for every line calling there, soonest first, each in its own line
colour. Pick a line for its next two buses and where they are headed. Live
times from TMB's iBus service, refreshed every half minute, with the clock on
screen throughout. Metropolitan AMB lines and Nitbus night buses included.

In Catalan, Spanish and English. Works on Pebble Time, Time 2, Time Round,
Pebble 2 and Core Devices watches.

*Unofficial: not affiliated with, endorsed by, or connected to Transports
Metropolitans de Barcelona. It reads TMB's public developer API. Bus times
are predictions and can be wrong — check the stop sign for the last bus of
the night.*

*Keywords: Barcelona, bus, TMB, AMB, iBus, bus times, arrival times, next
bus, bus stop, nearby stops, public transport, Nitbus, night bus, Catalonia,
transit, real-time.*

---

## What it is

Barcelona bus times on your wrist. A Pebble app — built with the Pebble
Time 2 in mind — that reads TMB's live arrivals service.

Three ways to reach a stop:

- **Preferides** — the stops you use every day.
- **A prop meu** — stops near you, by GPS, with how far each one is.
- **Cercar per codi** — type the code printed on the stop sign.

Open a stop and you get every line calling there, soonest first. Pick one
and you get that line's next two buses, in its own colour, with where it is
headed. Both screens refresh themselves every 30 seconds, and the time sits
at the top of all of them.

**Hold the middle button** on a stop to keep it or drop it; a star in the
header says whether it is kept. Catalan, Spanish and English, set from the
phone.

## Build and install

You need the [Pebble SDK](https://developer.repebble.com/), or
[CloudPebble](https://cloudpebble.repebble.com/) to work in the browser.

    pebble build
    pebble install --emulator emery       # or
    pebble install --phone <phone IP>     # with Developer Connection on

## How it works

The watch has no internet, so the app is two programs talking over
AppMessage:

    src/c/      the watch: screens, buttons, kept stops
    src/pkjs/   the phone: HTTPS to TMB

An AppMessage dictionary is small, so answers travel as one packed string
(`line|minutes|destination|colour;…`) rather than a key per field. A line
writes its destination and colour once, on its first bus, and the watch
fills in the rest. What fits is chosen by rank — every line's next bus
before anyone's second — so a busy stop never costs a line the bus its
detail screen is there to show.

**Kept stops live on the watch**, which is the source of truth; the phone
mirrors them so they can be edited from the settings screen, which is built
as a `data:` URI and needs no hosting and no npm.

### The API

Arrival times come from `/itransit/bus/parades/<code>`, which answers with
every bus it knows about, grouped by line:

    {"timestamp": …, "parades": [{ "codi_parada": "2775",
      "linies_trajectes": [{ "nom_linia": "H12", "desti_trajecte": "Gornal",
        "propers_busos": [{"temps_arribada": …}, {"temps_arribada": …}] }] }]}

Arrival times are absolute milliseconds, so a wait is a subtraction against
the response's own `timestamp` — the clock the prediction was made against,
which need not be the phone's. Rounded down, the way TMB rounds.

`/ibus/stops/<code>` is read as a fallback. It is flat and carries only the
first bus of each line, so a line's detail screen cannot show a second one
from it. Neither response carries the stop's name: what you see is the name
the watch already had.

### Nearby stops

The API cannot search by location — `filter` on `/transit/parades` matches
properties, not geometry — so the phone does it. The first time you use
*A prop meu* it downloads every TMB stop, keeps only code, name and
coordinates, and stores that. Searching is then a local distance sum. The
list is refreshed after a month, and a failed refresh falls back to the old
one rather than to no search at all.

### Line colours

Each line is drawn in its official colour, from `/transit/linies/bus`,
fetched once and kept like the stop list. It reaches the watch as **two
characters**: the screen has 64 colours, two bits a channel, and that byte
is the code.

That list only covers the lines TMB runs. Everything else is recognised from
the response itself (`transit_namespace: "amb"`): night buses take the
Nitbus blue — an N in the name beats knowing who drives it — and the rest of
the AMB's take its yellow.

## Testing

    ./tools/run-tests.sh

Runs the phone's JavaScript under Node, and builds the watch logic for the
host against stubs of `pebble.h` to exercise parsing, kept stops and the
message decoder. It also checks the watch code compiles for every platform
and calls nothing outside the small C library the watch actually has — a
missing one costs a crash on the wrist, not a build error.

No substitute for trying it on a watch, but it catches what can be caught
without hardware.

## Without a watch

The emulator runs the phone's JavaScript on your machine, so **real calls to
TMB work**.

    pebble install --emulator emery

Buttons map to the keyboard: `Q` back, `W` up, `S` select, `X` down. Hold a
key to hold the button — half a second on `S` searches a typed code.

With the app open, `pebble emu-app-config` opens the settings screen in your
desktop browser (language, search radius, kept stops). `pebble logs` shows
what the phone side is doing, `pebble screenshot` captures the screen, and
`pebble kill` stops a stuck emulator.

One thing you cannot test this way: **location**. The emulator's GPS is not
where you are, so *A prop meu* may return nothing sensible.

## Publishing

    pebble build      # the .pbw lands in build/

The bundle carries the UUID, version and platforms. Icons are drawn by
`python3 tools/make-icons.py` rather than kept as opaque files: the watch's
menu icon (`resources/images/menu-icon.png`) and the store's
(`docs/store-icon.png`).

What is left needs a watch or the emulator: **screenshots**, at each
platform's exact size (144×168 Basalt and Diorite, 180×180 Chalk, 200×228
Emery), via `pebble screenshot`.

## Licence

MIT. See [LICENSE](LICENSE).
