/*
 * richtext.js — Gras / italique dans le texte des éléments.
 *
 * Le texte reste une simple chaîne (compatibilité, export JSON, recherche), avec des
 * repères de type Markdown :  **gras**  *italique*  ***les deux***
 *  - un repère n'est actif que s'il a son partenaire de fermeture ; un « * » isolé
 *    (ex. anciennes notes : « 5 * 3 ») reste du texte ;
 *  - à l'écriture, les « * » et « \ » du texte sont échappés (\* et \\) → aller-retour exact.
 *
 * Logique pure (sauf renderRich / domToRuns, qui manipulent des nœuds sans innerHTML).
 * Expose : window.Notes.rich
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  // ---------------------------------------------------------------- lecture

  var WS = /\s/;

  /**
   * Découpe en jetons : texte, repère « ** » (b) ou « * » (i).
   * Règle façon Markdown : un repère peut OUVRIR s'il est suivi d'un caractère non blanc,
   * FERMER s'il est précédé d'un caractère non blanc. « 5 * 3 » n'est donc jamais un repère.
   */
  function tokenize(str) {
    var tokens = [], buf = '';
    function nonWs(ch) { return ch !== '' && ch !== undefined && !WS.test(ch); }
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '\\' && i + 1 < str.length && (str.charAt(i + 1) === '*' || str.charAt(i + 1) === '\\')) {
        buf += str.charAt(i + 1); i += 1; continue;
      }
      if (ch === '*') {
        if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; }
        var len = str.charAt(i + 1) === '*' ? 2 : 1;
        tokens.push({
          t: len === 2 ? 'b' : 'i', v: len === 2 ? '**' : '*',
          open: nonWs(str.charAt(i + len)), close: nonWs(str.charAt(i - 1))
        });
        i += len - 1;
        continue;
      }
      buf += ch;
    }
    if (buf) tokens.push({ t: 'text', v: buf });
    return tokens;
  }

  /** Apparie ouvrants / fermants de chaque type ; les repères orphelins redeviennent du texte. */
  function pairMarkers(tokens) {
    var openAt = { b: null, i: null };
    tokens.forEach(function (tk, k) {
      if (tk.t !== 'b' && tk.t !== 'i') return;
      if (openAt[tk.t] !== null && tk.close) { tk.paired = true; tokens[openAt[tk.t]].paired = true; openAt[tk.t] = null; }
      else if (tk.open) { if (openAt[tk.t] !== null) tokens[openAt[tk.t]].orphan = true; openAt[tk.t] = k; }
    });
    return tokens.map(function (tk) {
      return (tk.t === 'b' || tk.t === 'i') && !tk.paired ? { t: 'text', v: tk.v } : tk;
    });
  }

  /** Fusionne les morceaux voisins de même style et retire les morceaux vides. */
  function normalize(runs) {
    var out = [];
    runs.forEach(function (r) {
      if (!r.text) return;
      var last = out[out.length - 1];
      if (last && last.b === !!r.b && last.i === !!r.i) last.text += r.text;
      else out.push({ text: r.text, b: !!r.b, i: !!r.i });
    });
    return out;
  }

  /** Chaîne stockée → morceaux [{ text, b, i }]. */
  function parse(str) {
    var b = false, i = false, runs = [];
    pairMarkers(tokenize(String(str || ''))).forEach(function (tk) {
      if (tk.t === 'b') b = !b;
      else if (tk.t === 'i') i = !i;
      else runs.push({ text: tk.v, b: b, i: i });
    });
    return normalize(runs);
  }

  // ---------------------------------------------------------------- écriture

  function escapeText(s) { return s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*'); }

  /**
   * Les blancs en bordure d'un morceau prennent le style commun à leurs voisins :
   * ainsi un repère n'est jamais collé à un espace (sinon il ne serait pas relu).
   */
  function settleWhitespace(runs) {
    var pieces = [];
    normalize(runs).forEach(function (r) {
      var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
      if (m[1]) pieces.push({ text: m[1], ws: true });
      if (m[2]) pieces.push({ text: m[2], b: r.b, i: r.i });
      if (m[3]) pieces.push({ text: m[3], ws: true });
    });
    pieces.forEach(function (p, k) {
      if (!p.ws) return;
      var L = null, R = null, j;
      for (j = k - 1; j >= 0; j--) if (!pieces[j].ws) { L = pieces[j]; break; }
      for (j = k + 1; j < pieces.length; j++) if (!pieces[j].ws) { R = pieces[j]; break; }
      p.b = !!(L && R && L.b && R.b);
      p.i = !!(L && R && L.i && R.i);
    });
    return normalize(pieces);
  }

  /** Morceaux → chaîne stockée (repères équilibrés, texte échappé). */
  function serialize(runs) {
    var out = '', b = false, i = false;
    settleWhitespace(runs).forEach(function (r) {
      if (i && !r.i) { out += '*'; i = false; }
      if (b && !r.b) { out += '**'; b = false; }
      if (r.b && !b) { out += '**'; b = true; }
      if (r.i && !i) { out += '*'; i = true; }
      out += escapeText(r.text);
    });
    if (i) out += '*';
    if (b) out += '**';
    return out;
  }

  /** Texte sans mise en forme (recherche, info-bulles, lecteurs d'écran). */
  function plain(str) {
    return parse(str).map(function (r) { return r.text; }).join('');
  }

  /** Coupe une chaîne stockée à la position `offset` du texte visible → [avant, après]. */
  function split(str, offset) {
    var before = [], after = [], pos = 0;
    parse(str).forEach(function (r) {
      var end = pos + r.text.length;
      if (end <= offset) before.push(r);
      else if (pos >= offset) after.push(r);
      else {
        before.push({ text: r.text.slice(0, offset - pos), b: r.b, i: r.i });
        after.push({ text: r.text.slice(offset - pos), b: r.b, i: r.i });
      }
      pos = end;
    });
    return [serialize(before), serialize(after)];
  }

  /** Portion [a, b[ du texte visible, mise en forme comprise. */
  function slice(str, a, b) {
    var head = b === undefined ? str : split(str, b)[0];
    return split(head, a)[1];
  }

  /** Début et fin (texte visible) de la ligne qui contient la position `pos`. */
  function lineAt(str, pos) {
    var t = plain(str);
    pos = Math.max(0, Math.min(t.length, pos));
    var start = t.lastIndexOf('\n', pos - 1) + 1;
    var end = t.indexOf('\n', pos);
    if (end === -1) end = t.length;
    return { start: start, end: end, length: t.length, text: t.slice(start, end) };
  }

  /**
   * Où insérer une case à cocher dans un texte, curseur en `pos` :
   * après la ligne en cours (sans couper de mot). Sur une ligne vide, la case la remplace.
   * @returns {[string, string]}  [texte au-dessus, texte en dessous] (sans les sauts de ligne de jonction)
   */
  function cutAfterLine(str, pos) {
    var L = lineAt(str, pos);
    if (L.start === L.end) {                                   // ligne vide : elle disparaît
      return [L.start > 0 ? slice(str, 0, L.start - 1) : '', L.end < L.length ? slice(str, L.end + 1) : ''];
    }
    return [slice(str, 0, L.end), L.end < L.length ? slice(str, L.end + 1) : ''];
  }

  /** Met bout à bout deux chaînes stockées (fusion de lignes). */
  function concat(a, b) {
    return serialize(parse(a).concat(parse(b)));
  }

  // ---------------------------------------------------------------- DOM (sans innerHTML)

  /** Remplit un élément avec le texte mis en forme (<strong>, <em>, texte brut). */
  function renderRich(el, str) {
    el.textContent = '';
    parse(str).forEach(function (r) {
      var node = document.createTextNode(r.text);
      if (r.i) { var em = document.createElement('em'); em.appendChild(node); node = em; }
      if (r.b) { var st = document.createElement('strong'); st.appendChild(node); node = st; }
      el.appendChild(node);
    });
  }

  /**
   * Lit le contenu d'une zone éditable → morceaux. Reconnaît <b>/<strong>, <i>/<em>,
   * et les styles font-weight / font-style ; <br> et blocs → saut de ligne.
   */
  function domToRuns(root) {
    var runs = [];
    function walk(node, b, i) {
      if (node.nodeType === 3) { runs.push({ text: node.nodeValue, b: b, i: i }); return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'BR') { runs.push({ text: '\n', b: b, i: i }); return; }
      var st = node.style || {};
      var nb = b || tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600;
      var ni = i || tag === 'I' || tag === 'EM' || st.fontStyle === 'italic';
      if (st.fontWeight === 'normal' || st.fontWeight === '400') nb = false;
      if (st.fontStyle === 'normal') ni = false;
      var block = (tag === 'DIV' || tag === 'P') && node !== root;
      if (block && runs.length && runs[runs.length - 1].text.slice(-1) !== '\n') runs.push({ text: '\n', b: false, i: false });
      Array.prototype.forEach.call(node.childNodes, function (c) { walk(c, nb, ni); });
    }
    walk(root, false, false);
    // Un <br> final laissé par le navigateur ne compte pas
    var r = normalize(runs);
    if (r.length && /\n$/.test(r[r.length - 1].text)) {
      r[r.length - 1].text = r[r.length - 1].text.replace(/\n$/, '');
      r = normalize(r);
    }
    return r;
  }

  Notes.rich = {
    parse: parse,
    serialize: serialize,
    plain: plain,
    split: split,
    slice: slice,
    lineAt: lineAt,
    cutAfterLine: cutAfterLine,
    concat: concat,
    renderRich: renderRich,
    domToRuns: domToRuns
  };
})(window);
