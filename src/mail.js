// Lecture des mails enregistrés (.eml et .msg Outlook), sans service extérieur.
// Sortie commune : { sujet, deNom, deMail, date: Date|null, texte, pj: [{ nom, type, data: Uint8Array }], format }

const dec = (bytes, cs = "utf-8") => {
  let c = String(cs || "utf-8").toLowerCase().replace(/^cp/, "windows-").replace(/^(latin-?1|iso8859-1)$/, "iso-8859-1");
  try { return new TextDecoder(c).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
};
// octets -> chaîne (1 octet = 1 caractère), sans table de conversion
const binaire = (b) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
const latin = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const b64 = (s) => { const t = atob(s.replace(/[^A-Za-z0-9+/=]/g, "")); return latin(t); };
const qp = (s) => latin(s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))));

// mots encodés des en-têtes : =?utf-8?Q?...?= ou =?utf-8?B?...?=
function motsEncodes(s) {
  return String(s || "").replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (m, cs, e, t) =>
    dec(/b/i.test(e) ? b64(t) : latin(t.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)))), cs));
}

export function htmlVersTexte(h) {
  return String(h)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, "\n").replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&euro;/g, "€").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç").replace(/&ecirc;/g, "ê").replace(/&ocirc;/g, "ô").replace(/&sup2;/g, "²")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function adresse(v) {
  const s = motsEncodes(v || "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { nom: m[1].trim(), mail: m[2].trim() };
  const e = s.match(/[\w.+-]+@[\w.-]+/);
  return { nom: "", mail: e ? e[0] : s };
}

// ---------- .eml (MIME)
function entetes(bloc) {
  const h = {};
  bloc.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((l) => { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim(); } });
  return h;
}
const param = (v, p) => {
  const m = String(v || "").match(new RegExp(`${p}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i"));
  if (!m) return "";
  let x = m[1] ?? m[2];
  const r = x.match(/^([\w-]+)''(.*)$/); // RFC 2231
  if (r) x = dec(latin(r[2].replace(/%([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))), r[1]);
  return motsEncodes(x);
};
export function lireEml(bytes) {
  const brut = binaire(bytes); // 1 octet = 1 caractère, on redécode chaque partie ensuite
  const out = { format: "eml", textes: [], htmls: [], pj: [] };
  function partie(s) {
    const cut = s.search(/\r?\n\r?\n/);
    const h = entetes(cut < 0 ? s : s.slice(0, cut));
    const corps = cut < 0 ? "" : s.slice(cut).replace(/^\r?\n\r?\n/, "");
    const ct = h["content-type"] || "text/plain", type = ct.split(";")[0].trim().toLowerCase();
    if (/^multipart\//.test(type)) {
      const b = param(ct, "boundary");
      if (!b) return h;
      const morceaux = corps.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
      for (const m of morceaux.slice(1)) if (m.trim()) partie(m);
      return h;
    }
    const enc = (h["content-transfer-encoding"] || "").toLowerCase();
    const data = enc === "base64" ? b64(corps) : enc === "quoted-printable" ? qp(corps) : latin(corps);
    const disp = h["content-disposition"] || "";
    const nom = param(disp, "filename") || param(ct, "name");
    if (type === "message/rfc822") { out.pj.push({ nom: nom || "message.eml", type, data }); return h; }
    if (nom || /attachment/i.test(disp) || !/^text\//.test(type)) { out.pj.push({ nom: nom || "piece-jointe", type, data }); return h; }
    const txt = dec(data, param(ct, "charset") || "utf-8");
    (type === "text/html" ? out.htmls : out.textes).push(txt);
    return h;
  }
  const h = partie(brut);
  const de = adresse(h.from);
  out.sujet = motsEncodes(h.subject || "");
  out.deNom = de.nom; out.deMail = de.mail;
  const d = h.date ? new Date(h.date) : null;
  out.date = d && !isNaN(d) ? d : null;
  out.texte = out.textes.length ? out.textes.join("\n\n") : out.htmls.map(htmlVersTexte).join("\n\n");
  delete out.textes; delete out.htmls;
  return out;
}

// ---------- .msg (Outlook, fichier composé) : nécessite la bibliothèque CFB
export function lireMsg(bytes, CFB) {
  const cfb = CFB.read(bytes, { type: "array" });
  const flux = (chemin) => {
    const e = CFB.find(cfb, chemin);
    return e && e.content ? new Uint8Array(e.content) : null;
  };
  const props = (racine) => {
    const p = flux(racine + "__properties_version1.0");
    const res = {};
    if (!p) return res;
    const debut = racine === "/" ? 32 : 8;
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    for (let o = debut; o + 16 <= p.length; o += 16) {
      const tag = dv.getUint32(o, true);
      res[tag] = { lo: dv.getUint32(o + 8, true), hi: dv.getUint32(o + 12, true) };
    }
    return res;
  };
  const racine = "/";
  const pr = props(racine);
  const cpid = pr[0x3fde0003]?.lo || pr[0x3ffd0003]?.lo || 1252;
  const cs = cpid === 65001 ? "utf-8" : cpid === 28591 ? "iso-8859-1" : `windows-${cpid}`;
  const chaine = (base, id) => {
    const u = flux(`${base}__substg1.0_${id}001F`);
    if (u) return dec(u, "utf-16le").replace(/\0+$/, "");
    const a = flux(`${base}__substg1.0_${id}001E`);
    return a ? dec(a, cs).replace(/\0+$/, "") : "";
  };
  const out = { format: "msg", pj: [] };
  out.sujet = chaine(racine, "0037");
  out.deNom = chaine(racine, "0C1A") || chaine(racine, "0042");
  out.deMail = chaine(racine, "5D01") || chaine(racine, "0C1F") || chaine(racine, "0065");
  if (!/@/.test(out.deMail)) { const h = chaine(racine, "007D").match(/^From:.*$/im); if (h) { const a = adresse(h[0].slice(5)); out.deMail = a.mail; out.deNom = out.deNom || a.nom; } }
  const t = pr[0x00390040] || pr[0x0e060040];
  out.date = t ? new Date(((t.hi * 4294967296 + t.lo) / 1e4) - 11644473600000) : null;
  let texte = chaine(racine, "1000");
  if (!texte.trim()) { const h = flux(`${racine}__substg1.0_10130102`); if (h) texte = htmlVersTexte(dec(h, cs)); }
  if (!texte.trim()) { const r = flux(`${racine}__substg1.0_10090102`); if (r) texte = rtfVersTexte(lzfu(r)); }
  out.texte = texte;
  // pièces jointes
  const dossiers = [...new Set(cfb.FullPaths.map((p) => (p.match(/^(?:[^/]*\/)?(__attach_version1\.0_#[0-9A-F]{8})\/$/i) || [])[1]).filter(Boolean))];
  for (const d of dossiers) {
    const base = "/" + d + "/";
    const data = flux(`${base}__substg1.0_37010102`);
    if (!data) continue; // message joint ou objet OLE : ignoré
    const nom = chaine(base, "3707") || chaine(base, "3704") || "piece-jointe";
    out.pj.push({ nom, type: chaine(base, "370E"), data });
  }
  return out;
}

// RTF compressé (LZFu) puis RTF vers texte, pour les .msg sans corps texte
function lzfu(src) {
  const PRE = "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\n\r\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const rawSize = dv.getUint32(4, true), magic = dv.getUint32(8, true);
  if (magic === 0x414c454d) return dec(src.slice(16), "windows-1252");
  const dict = new Uint8Array(4096); for (let i = 0; i < PRE.length; i++) dict[i] = PRE.charCodeAt(i);
  let w = PRE.length, i = 16; const out = [];
  while (i < src.length && out.length < rawSize) {
    const flags = src[i++];
    for (let b = 0; b < 8 && i < src.length && out.length < rawSize; b++) {
      if (flags & (1 << b)) {
        const ref = (src[i] << 8) | src[i + 1]; i += 2;
        let off = ref >> 4; const len = (ref & 15) + 2;
        if (off === (w & 4095)) return dec(new Uint8Array(out), "windows-1252");
        for (let k = 0; k < len; k++) { const c = dict[(off + k) & 4095]; out.push(c); dict[w & 4095] = c; w++; }
      } else { const c = src[i++]; out.push(c); dict[w & 4095] = c; w++; }
    }
  }
  return dec(new Uint8Array(out), "windows-1252");
}
function rtfVersTexte(r) {
  const h = r.match(/\\fromhtml/) ? r : null;
  let s = r.replace(/\{\\\*[^{}]*\}/g, "").replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\tab\b/g, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (m, x) => String.fromCharCode(parseInt(x, 16))).replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
  if (h) s = htmlVersTexte(s);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function lireMail(nomFichier, bytes, CFB) {
  const estMsg = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (estMsg) return lireMsg(bytes, CFB);
  return lireEml(bytes);
}
