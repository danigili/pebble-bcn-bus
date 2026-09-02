/*
 * The settings page, served as a data: URI.
 *
 * Built by hand rather than with Clay so the app has no npm dependency and
 * nothing to host. Note that a data: URI has a null origin, so this page
 * cannot call the TMB API itself: everything it needs is baked in before it
 * is opened, and everything it produces goes back through the close URL.
 */

function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildConfigPage(settings, favourites) {
  var state = JSON.stringify({
    app_id: settings.app_id || '',
    app_key: settings.app_key || '',
    lang: settings.lang || 'ca',
    radius: settings.radius || 500,
    favs: favourites || []
  }).replace(/</g, '\\u003c');

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>BCN Bus</title><style>',
    '*{box-sizing:border-box}',
    'body{margin:0;padding:16px 14px 96px;font:15px/1.45 -apple-system,',
    'BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#15171a;color:#f2f4f6}',
    'h1{font-size:19px;margin:0 0 4px}',
    'p.sub{margin:0 0 22px;color:#9aa3ad;font-size:13px}',
    'h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;',
    'color:#9aa3ad;margin:26px 0 10px;font-weight:600}',
    'label{display:block;font-size:13px;color:#c6cdd4;margin:12px 0 5px}',
    'input,select{width:100%;padding:11px 12px;border-radius:9px;',
    'border:1px solid #333940;background:#1e2126;color:#f2f4f6;font-size:15px}',
    'input:focus,select:focus{outline:none;border-color:#d6001c}',
    '.hint{font-size:12px;color:#7d868f;margin-top:6px}',
    '.fav{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
    '.fav input.code{flex:0 0 82px}.fav input.name{flex:1 1 auto}',
    '.del{flex:0 0 auto;background:#2a2e34;border:1px solid #3a4048;color:#ff8b8b;',
    'border-radius:9px;padding:11px 13px;font-size:15px;line-height:1}',
    '.add{width:100%;margin-top:6px;background:#1e2126;border:1px dashed #3f4650;',
    'color:#c6cdd4;border-radius:9px;padding:11px;font-size:14px}',
    '.empty{color:#7d868f;font-size:13px;padding:6px 0 2px}',
    '.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 14px;',
    'background:#15171a;border-top:1px solid #262b31}',
    '.save{width:100%;background:#d6001c;color:#fff;border:0;border-radius:10px;',
    'padding:14px;font-size:16px;font-weight:600}',
    '</style></head><body>',
    '<h1>BCN Bus</h1>',
    '<p class="sub">Temps d\'espera de TMB al rellotge.</p>',

    '<h2>Credencials TMB</h2>',
    '<label for="id">app_id</label><input id="id" autocapitalize="off" ',
    'autocorrect="off" spellcheck="false">',
    '<label for="key">app_key</label><input id="key" autocapitalize="off" ',
    'autocorrect="off" spellcheck="false">',
    '<div class="hint">Registra una aplicaci&oacute; a developer.tmb.cat per ',
    'obtenir-les. Es guarden nom&eacute;s al tel&egrave;fon.</div>',

    '<h2>Prefer&egrave;ncies</h2>',
    '<label for="lang">Idioma</label><select id="lang">',
    '<option value="ca">Catal&agrave;</option>',
    '<option value="es">Castellano</option>',
    '<option value="en">English</option></select>',
    '<label for="radius">Radi de cerca per GPS (metres)</label>',
    '<input id="radius" type="number" min="100" max="2000" step="50">',

    '<h2>Favorites</h2>',
    '<div class="hint" style="margin:0 0 10px">Tamb&eacute; pots desar-les des ',
    'del rellotge mantenint premut el bot&oacute; central a la pantalla d\'una parada.</div>',
    '<div id="favs"></div>',
    '<button class="add" id="add" type="button">+ Afegir parada</button>',

    '<div class="bar"><button class="save" id="save" type="button">Desa</button></div>',

    '<script>',
    'var S=', state, ';',
    'document.getElementById("id").value=S.app_id;',
    'document.getElementById("key").value=S.app_key;',
    'document.getElementById("lang").value=S.lang;',
    'document.getElementById("radius").value=S.radius;',
    'var box=document.getElementById("favs");',
    'function row(f){',
    ' var d=document.createElement("div");d.className="fav";',
    ' var c=document.createElement("input");c.className="code";c.placeholder="Codi";',
    ' c.setAttribute("inputmode","numeric");c.value=f.code||"";',
    ' var n=document.createElement("input");n.className="name";n.placeholder="Nom";',
    ' n.value=f.name||"";',
    ' var b=document.createElement("button");b.className="del";b.type="button";',
    ' b.textContent="\\u00d7";',
    ' b.onclick=function(){box.removeChild(d);draw();};',
    ' d.appendChild(c);d.appendChild(n);d.appendChild(b);return d;',
    '}',
    'function draw(){',
    ' var e=box.querySelector(".empty");',
    ' if(box.querySelectorAll(".fav").length===0){',
    '  if(!e){var p=document.createElement("div");p.className="empty";',
    '   p.textContent="Cap parada desada.";box.appendChild(p);}',
    ' } else if(e){box.removeChild(e);}',
    '}',
    'for(var i=0;i<S.favs.length;i++)box.appendChild(row(S.favs[i]));',
    'draw();',
    'document.getElementById("add").onclick=function(){',
    ' var e=box.querySelector(".empty");if(e)box.removeChild(e);',
    ' box.appendChild(row({}));draw();',
    '};',
    'document.getElementById("save").onclick=function(){',
    ' var favs=[],rows=box.querySelectorAll(".fav");',
    ' for(var i=0;i<rows.length;i++){',
    '  var code=rows[i].querySelector(".code").value.replace(/[^0-9]/g,"");',
    '  if(!code)continue;',
    '  var name=rows[i].querySelector(".name").value.replace(/[|;]/g,"/").trim();',
    '  favs.push({code:code,name:name||code});',
    ' }',
    ' var out={app_id:document.getElementById("id").value.trim(),',
    '  app_key:document.getElementById("key").value.trim(),',
    '  lang:document.getElementById("lang").value,',
    '  radius:parseInt(document.getElementById("radius").value,10)||500,',
    '  favs:favs};',
    ' location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify(out));',
    '};',
    '</script></body></html>'
  ].join('');
}

var CONFIG = { buildConfigPage: buildConfigPage };

if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
