# BCN Bus

Temps d'espera dels autobusos de TMB al canell. App per a Pebble, pensada per
al **Pebble Time 2**, que consulta el servei iBus de Transports Metropolitans
de Barcelona.

Tres maneres d'arribar a una parada, i una sola manera de desar-la:

- **Preferides** — les parades que fas servir cada dia.
- **A prop meu** — busca parades per GPS.
- **Cercar per codi** — tecleja el codi imprès al pal de la parada.

En clicar una parada s'obre la seva llista: totes les línies que hi passen,
ordenades per qui arriba abans, amb el dorsal i els minuts en gran. El
destí hi surt si la pantalla és prou ampla —a 144 px no hi caben tres
columnes, i dues lletres i uns punts suspensius són pitjor que res: el
destí sencer és a la pantalla de la línia. **Seleccionant-ne una** s'obre el detall
d'aquella línia: **els dos propers autobusos**, una fila cadascun, amb el
color de la línia, cap on va i a quina parada els esperes. Si el servei
només en coneix un, ho diu.

Els minuts van tan grans com la pantalla permet, amb el número en gran i el
"min" petit al costat: el número és el que es llegeix de cop. Els números
van alineats en columna, de manera que les dues files es comparen d'un
cop d'ull. Totes dues pantalles es
refresquen soles cada 30 s.

Des de la pantalla d'una parada, **mantén premut el botó central** per desar-la
a preferides o treure-la; una **estrella** a la capçalera diu si ja hi és. Funciona igual hi hagis arribat com hi hagis arribat.

**L'hora surt a dalt de totes les pantalles.** La dibuixa la barra d'estat del
sistema (`StatusBarLayer`), o sigui que és el rellotge del rellotge, amb el
format que hi tinguis posat, i l'app no n'ha de mantenir cap.

## Credencials

Les credencials de l'API de TMB **venen incloses** a `src/pkjs/tmb.js`, així
que no cal configurar res: instal·la l'app i ja consulta temps d'espera.

Van dins del paquet de JavaScript que arriba al mòbil i el codi és públic, de
manera que a la pràctica són credencials públiques i la quota és compartida.
Si un dia s'esgota o les vols teves, registra una aplicació a
[developer.tmb.cat](https://developer.tmb.cat/) i canvia `APP_ID` i `APP_KEY`
en aquell fitxer.

## Compilar i instal·lar

Necessites el SDK de Pebble ([developer.repebble.com](https://developer.repebble.com/)),
o bé [CloudPebble](https://cloudpebble.repebble.com/) si prefereixes el navegador.

    pebble build

Després, instal·la-ho **a l'emulador**:

    pebble install --emulator emery

o bé **a un rellotge de veritat**, passant la IP que et mostra l'app de Pebble
del mòbil quan hi actives la *Developer Connection*:

    pebble install --phone <IP del mòbil>

Són dues alternatives del mateix comandament, no dos passos: amb l'emulador no
hi ha cap mòbil ni cap IP pel mig.

## Com està fet

El rellotge no té connexió a internet, així que l'app són dos programes:

    src/c/      codi del rellotge: pantalles, botons, preferides
    src/pkjs/   JavaScript que corre al mòbil: crides HTTPS a l'API de TMB

Es parlen per AppMessage. Com que el diccionari d'AppMessage és petit, les
respostes viatgen empaquetades en una sola cadena (`línia|minuts|destí;…`) en
comptes d'una clau per camp.

Cada línia diu el seu **destí i el seu color una sola vegada**, al seu primer
bus; als altres es deixen en blanc i el rellotge els hereta. Repetir-ho a
cada registre costava el segon bus d'unes quantes línies.

Aquesta cadena té un límit i el rellotge en guarda un nombre fix d'arribades,
així que el que queda fora importa. Si s'omplís per ordre d'arribada, en una
parada amb una dotzena de línies hi cabrien el primer bus de cadascuna i la
cua de les dues o tres més primerenques: totes les altres perdrien el segon
bus, que és precisament el que va a buscar el detall d'una línia.

Per això s'omple **per rondes**: el proper bus de cada línia, després el
següent de cada línia, i llavors els tercers. El rellotge els torna a
ordenar per temps en rebre'ls, de manera que la llista de la parada es
llegeix com un plafó de sortides.

Les **preferides viuen al rellotge**, que n'és la font de veritat; el mòbil en
guarda una còpia perquè es puguin editar des de la configuració. Per això
desar una parada segueix funcionant amb el mòbil fora de cobertura.

La pantalla de configuració es genera com una URI `data:` i no necessita ni
allotjament ni cap dependència de npm.

### Les parades a prop

L'API **no sap buscar per ubicació**: el paràmetre `filter` de
`/transit/parades` filtra per propietats (`ID_POBLACIO=748`), no per
geometria. O sigui que la cerca per proximitat es fa al mòbil.

Cada parada de la llista mostra **a quina distància és**, en metres, a baix a
la dreta.

El primer cop que fas servir *A prop meu*, el mòbil es baixa totes les
parades de TMB, les redueix a codi, nom i coordenades —la resta de camps es
llencen— i es guarda la llista. A partir d'aquí, buscar és calcular
distàncies en local: instantani i sense tornar a sortir a la xarxa. La
llista es refresca al cap d'un mes, i si la descàrrega falla es fa servir la
que hi ha encara que sigui vella, que sempre és millor que no poder buscar.

### Els colors de les línies

Cada línia es dibuixa amb **el seu color oficial**, que ve de
`/transit/linies/bus`: el mòbil se'l baixa un cop, se'l guarda un mes com fa
amb les parades, i l'envia al rellotge amb les arribades.

Hi viatja **en dos caràcters**, no en sis. La pantalla del rellotge té 64
colors —dos bits per canal, un byte— i aquest byte és el codi: `E30613` de
la V29 hi va com a `F0`. No es perd res que es pogués veure, i el missatge
cap al rellotge s'estalvia quatre caràcters per línia.

Aquella llista, però, només porta **les línies que opera TMB**. Les dels
altres operadors de l'AMB no hi són, i es reconeixen per la resposta mateixa
(`transit_namespace: "amb"`): van amb el groc de l'AMB. La B24 sortia
vermella per això.

Amb una excepció que va abans: **els busos de nit**. El Nitbus també el
porta l'AMB, així que mirar només qui opera la línia pintava tota la xarxa
nocturna de groc. Una línia que es diu N8 ja diu el que és, i el seu blau
fosc guanya.

La deducció per la primera lletra només queda per als primers segons després
d'instal·lar, abans que el mòbil tingui la llista.

### El teclat

Tota l'app va amb botons, també el teclat numèric: amunt i avall canvien la
xifra (mantenint-los, gira sola), el central avança a la següent, i
**mantenir premut el central cerca** — no hi ha cap tecla d'acceptar, així
que la pantalla ho diu en gran. Enrere esborra l'última xifra i, si només en
queda una, surt de la pantalla. No es fa servir la pantalla tàctil enlloc.

## Provar els canvis

    ./tools/run-tests.sh

Comprova el JavaScript del mòbil amb Node, i compila la lògica del rellotge
per a l'ordinador contra uns *stubs* de `pebble.h` per verificar el parsing,
les preferides i el descodificador de missatges —aquest darrer incloent
`comm.c` en comptes d'enllaçar-lo, per poder provar el codi de debò i no una
còpia. També comprova que el codi compila per a totes les plataformes.
No substitueix provar-ho al rellotge, però atrapa el que es pot atrapar sense
maquinari.

## Provar-ho sense rellotge

El SDK porta emulador, i el JavaScript del mòbil corre a la teva màquina, així
que **les crides reals a l'API de TMB funcionen**, credencials incloses.

    pebble build
    pebble install --emulator emery

Els botons del rellotge es mapegen al teclat: `Q` enrere, `W` amunt, `S`
central, `X` avall (o les fletxes). Per mantenir premut un botó, mantén la
tecla: per cercar un codi, deixa `S` premuda mig segon.

Per tocar l'idioma, el radi de cerca o les preferides, amb **l'app oberta a
l'emulador**, executa en una altra terminal:

    pebble emu-app-config

La pantalla de configuració s'obre al navegador de l'escriptori, no dins de
l'emulador. En desar, torna per una URL local que el simulador de telèfon
recull, i des d'allà les preferències es guarden i les preferides baixen al
rellotge. Si has sortit de l'app i ets a l'esfera, el comandament no trobarà
cap configuració a obrir.

En un rellotge de veritat no cal res d'això: obre l'app de Pebble al mòbil,
busca BCN Bus a la llista i toca l'engranatge.

I per veure què passa per dins, fer una captura, o desencallar l'emulador:

    pebble logs
    pebble screenshot
    pebble kill      # atura emulador i simulador de mòbil
    pebble wipe      # neteja la memòria si es queda penjat

Una cosa que **no** podràs comprovar fins que tinguis el rellotge:

- **La ubicació.** El GPS de l'emulador no és la teva posició real, de manera
  que “A prop meu” pot no retornar res que tingui sentit.

També pots fer servir [CloudPebble](https://cloudpebble.repebble.com/), que
porta l'emulador al navegador sense instal·lar res.

## Coses pendents de verificar

Els temps es demanen a `/itransit/bus/parades/<codi>`, que respon amb tots
els busos que venen, agrupats per línia:

    {"timestamp": …, "parades": [{ "codi_parada": "2775",
      "linies_trajectes": [{ "nom_linia": "H12", "desti_trajecte": "Gornal",
        "propers_busos": [{"temps_arribada": …}, {"temps_arribada": …}] }] }]}

Els temps són absoluts, en mil·lisegons, i els minuts surten de restar-los
del `timestamp` de la mateixa resposta —el rellotge contra el qual s'ha fet
la predicció, que no té per què coincidir amb el del mòbil.

Hi ha un altre endpoint, `/ibus/stops/<codi>`, que respon pla i **només amb
el primer bus de cada línia**:

    {"status":"success","data":{"ibus":[
      {"line":"V23","routeId":"2230","destination":"Can Marcet",
       "t-in-min":5,"t-in-s":323,"text-ca":"5 min"}]}}

Es llegeix també, de reserva. Amb aquest el detall d'una línia no podria
mostrar el segon bus, perquè no hi és. D'aquí, els minuts es fan servir tal
com vénen: recalcular-los de `t-in-s` faria que 596 segons es veiessin com
a 10 min quan TMB en diu 9 a tot arreu.

Cap de les dues respostes porta el nom de la parada: el que es veu és el que
ja té el rellotge, de les preferides o de la cerca per GPS.

El camí d'iBus, en canvi, ja està escrit contra la resposta de debò: temps
d'arribada absoluts dins de `parades[].linies_trajectes[].propers_busos[]`,
que es resten del `timestamp` de la mateixa resposta per saber quants minuts
falten.

## Publicar-la

    pebble build            # deixa el .pbw a build/

El paquet que se'n surt ja porta l'UUID, la versió i les plataformes, i és
el que es puja a la fitxa de la store. Les icones no són a mà: les dibuixa
`python3 tools/make-icons.py`, i d'aquí surten la del menú del rellotge
(`resources/images/menu-icon.png`, 25 px, blanc sobre res) i la de la fitxa
(`docs/store-icon.png`, 144 px).

El que hi falta i només es pot fer amb un rellotge o l'emulador a mà són
**les captures**, que la store demana a la mida exacta de cada plataforma
(144×168 Basalt i Diorite, 180×180 Chalk, 200×228 Emery):

    pebble install --emulator emery
    pebble screenshot

I una cosa a decidir abans de publicar, no després: **les credencials de
TMB van dins del paquet**. Qui se la instal·li farà servir les teves i la
quota és compartida. Si això no fa el pes, tornen a la pantalla de
configuració i cadascú hi posa les seves.

## Llicència

MIT. Vegeu [LICENSE](LICENSE).
