// =====================================================================
// LECTURE D'UN INFO MÉMO, sans IA : les valeurs sont repérées par leur format et des mots-clés.
// Entrée : pages = [[{text, size, x0, x1, y, cells}], ...] (lignes reconstituées par lignesPdfjs).
// Sortie : { champs: { clé: { value, candidates, status, note, loc } }, faits, etatLocatif, alertes, texte }
//
// Plan du fichier
//   BROKERS ............ brokers reconnus et leurs différentes écritures (à compléter si besoin)
//   VILLES / secteurFromCp  secteur géographique à partir du CP ou de la ville
//   extraire() ......... règles champ par champ : surfaces, montants, adresse, CP, nom, typologie,
//                        régime, situation locative, WALB, dates, apporteur, contact, mode, description
//   rediger() .......... description rédigée par phrases types
//   lireEtatLocatif() .. tableau des locataires
//   lireTuiles() ....... chiffres clés en gros caractères (one pagers)
//   analyserDocument() . découpe un deck en une fiche par page
//   fusionnerMail() .... fusion du texte d'un mail avec ses PDF joints
//   lireListesCollees() / lireContactsColles()  mise à jour des listes
//   lignesPdfjs() ...... reconstitue les lignes à partir du texte brut de pdf.js
// =====================================================================

const NB = "[\\s\\u00a0\\u202f]";
const NUM = `(\\d{1,3}(?:${NB}?[\\.]?${NB}?\\d{3})+|\\d+)(?:[,.](\\d+))?`;

function toNumber(intPart, dec) {
  const i = intPart.replace(/[\s  .]/g, "");
  return parseFloat(dec ? `${i}.${dec}` : i);
}
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtEur = (v) => Math.round(v).toLocaleString("fr-FR") + " €";
const fmtM2 = (v) => Math.round(v).toLocaleString("fr-FR") + " m²";
const clip = (s, n = 110) => (s.length > n ? s.slice(0, n) + "…" : s);

const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };

// BROKERS RECONNUS : ["Nom exact dans la liste Apporteurs de l'Excel", /écritures possibles/]
// Les écritures sont en minuscules et sans accents, séparées par | (ex. /bnppre|bnpp re/).
// Un apporteur ajouté dans l'onglet Listes est reconnu automatiquement par son nom exact.
const BROKERS = [
  ["BNP Paribas Real Estate", /bnp\s*paribas\s*(real\s*estate|re\b|immobilier)|bnpp?\s*-?\s*re\b|bnppre|realestate\.bnpparibas/],
  ["OFF Business Club", /off\s*business\s*club/],
  ["CBRE", /\bcbre\b/], ["JLL", /\bjll\b|jones\s*lang/], ["Cushman & Wakefield", /cushman|cushwake/],
  ["Knight Frank", /knight\s*frank|knightfrank/], ["Savills", /savills/], ["Colliers", /colliers/],
  ["Catella", /catella/], ["Newmark", /newmark|nmrk/], ["Arthur Loyd", /arthur\s*loyd/], ["Evolis", /evolis/],
  ["Advicom", /advicom/], ["Colombus", /colombus/], ["Flabeau", /flabeau/], ["Strategies & Corp", /strategies\s*(&|and|et)\s*corp/],
  ["T1C Real Estate", /t1c/], ["Eastdil Secured", /eastdil/], ["Rothschild & Co", /rothschild/], ["Lazard", /lazard/],
  ["Avison Young", /avison\s*young/], ["Alex Bolton", /alex\s*bolton/], ["BPCE Solutions immobilières", /bpce/],
  ["Bridge Real Estate", /bridge\s*real\s*estate/], ["Green Belt REIM", /green\s*belt/], ["Immprove", /immprove/],
  ["Barnes", /\bbarnes\b/], ["Christie's", /christie/], ["Daniel Féau", /daniel\s*feau/], ["Engel & Völkers", /engel/],
  ["John Taylor", /john\s*taylor/], ["Demathieu Bard", /demathieu/], ["Knight Frank", /knight/],
];

// brokers connus + apporteurs ajoutés dans l'onglet Listes (reconnus par leur nom exact)
const NON_BROKERS = /^(vendeur en direct|reseau|apport interne|reseau \/ apport interne|autre|level|direct|notaire)$/;
let cacheBrokers = { data: null, liste: BROKERS };
function listeBrokers(data) {
  if (cacheBrokers.data === data && data) return cacheBrokers.liste;
  const extra = [];
  for (const a of data?.Apporteurs || []) {
    const n = norm(a).replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();
    if (n.length < 4 || NON_BROKERS.test(n) || BROKERS.some(([nom]) => nom === a)) continue;
    extra.push([a, new RegExp("\\b" + n.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s.-]*") + "\\b")]);
  }
  // un nom de la liste Excel remplace l'orthographe interne quand ils désignent le même broker
  const liste = [...BROKERS.map(([nom, re]) => [(data?.Apporteurs || []).find((a) => norm(a) === norm(nom)) || nom, re]), ...extra];
  cacheBrokers = { data, liste };
  return liste;
}

const VILLES = {
  "Croissant Ouest (92)": /boulogne|issy|levallois|neuilly|clichy|vanves|malakoff|montrouge|chatillon|clamart|meudon|sevres|saint-cloud|suresnes|rueil|asnieres|colombes|gennevilliers|bois-colombes|la garenne|nanterre|chaville|ville-d.avray|bourg-la-reine|antony|sceaux|bagneux|fontenay-aux-roses|le plessis/,
  "La Défense": /la defense|courbevoie|puteaux/,
  "Première couronne Nord (93)": /saint-denis|saint-ouen|montreuil|aubervilliers|pantin|bagnolet|les lilas|le pre-saint-gervais|noisy|bobigny|romainville|bondy|rosny|la plaine/,
  "Première couronne Est / Sud (94)": /vincennes|saint-mande|charenton|ivry|vitry|creteil|maisons-alfort|fontenay-sous-bois|nogent|joinville|gentilly|arcueil|cachan|kremlin|villejuif|rungis|bonneuil|saint-maur|champigny/,
};

function secteurFromCp(cp, ville) {
  if (cp && /^75/.test(cp)) {
    const a = parseInt(cp.slice(-2), 10) || (cp === "75116" ? 16 : 0);
    if ([1, 2, 8, 9].includes(a)) return "Paris QCA";
    if ([3, 4, 16, 17].includes(a)) return "Paris Centre Ouest hors QCA";
    if ([5, 6, 7, 13, 14, 15].includes(a)) return "Paris Rive Gauche";
    if ([10, 11, 12, 18, 19, 20].includes(a)) return "Paris Nord-Est";
  }
  const v = norm(ville || "");
  for (const [s, re] of Object.entries(VILLES)) if (re.test(v)) return s;
  if (cp && /^9[2-4]/.test(cp)) return { "92": "Croissant Ouest (92)", "93": "Première couronne Nord (93)", "94": "Première couronne Est / Sud (94)" }[cp.slice(0, 2)];
  if (cp && /^(77|78|91|95)/.test(cp)) return "Deuxième couronne";
  if (cp) return "Régions";
  return "";
}

function parseDate(s) {
  let m = s.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/);
  if (m) return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  m = norm(s).match(/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/);
  if (m) return `${m[1].padStart(2, "0")}/${String(MOIS[m[2]]).padStart(2, "0")}/${m[3]}`;
  return null;
}

export function extraire(pages, data, opts = {}) {
  const lines = [];
  pages.forEach((pg, p) => pg.forEach((l) => lines.push({ text: l.text.replace(/\s+/g, " ").trim(), size: l.size, page: p + 1, x0: l.x0, x1: l.x1, y: l.y, cells: l.cells })));
  const locOf = (i) => (lines[i] && lines[i].x0 != null ? { page: lines[i].page, x0: lines[i].x0, x1: lines[i].x1, y: lines[i].y, h: lines[i].size } : null);
  const full = lines.map((l) => l.text).join("\n");
  const nfull = norm(full);
  // lignes répétées sur 3 pages ou plus : pieds de page, mentions légales
  const freq = {};
  lines.forEach((l) => { const k = norm(l.text); (freq[k] = freq[k] || new Set()).add(l.page); });
  const repete = (l) => pages.length >= 4 && freq[norm(l.text)].size >= 3 && l.text.length > 12;
  const out = {};
  const set = (k, value, candidates = [], status) =>
    (out[k] = { value: value ?? "", candidates, status: status || (value !== "" && value != null ? "trouve" : "vide") });
  const ctxOf = (i) => clip([lines[i - 1]?.text, lines[i].text].filter(Boolean).join(" / "), 140);

  // ---- montants, surfaces
  const amounts = [], surfaces = [];
  const reAmt = new RegExp(`${NUM}${NB}*(M${NB}?€|m€|millions?${NB}*(?:d.${NB}*)?(?:euros|€)|k€|K€|€|euros?\\b|EUR\\b)`, "gi");
  const reSurf = new RegExp(`${NUM}${NB}*(m²|m2\\b|m${NB}2\\b|sqm)`, "gi");
  // libellé situé à gauche sur la même ligne visuelle (tableaux « libellé | valeur »)
  const gauche = (i) => {
    const l = lines[i]; if (l.x0 == null) return "";
    return lines.filter((o, j) => j !== i && o.page === l.page && Math.abs(o.y - l.y) < Math.max(3, l.size * 0.4) && o.x1 != null && o.x1 <= l.x0 + 2)
      .sort((a, b) => b.x1 - a.x1).slice(0, 1).map((o) => o.text).join(" ");
  };
  lines.forEach((l, i) => {
    const t = l.text;
    const lab = /^[\s\d€.,%kKmM²/:-]*$/.test(t.replace(/(m²|M€|K€|k€|€|HT|HC|ht|hc|an)/g, "")) ? norm(gauche(i)) + " " : "";
    for (const m of t.matchAll(reAmt)) {
      let v = toNumber(m[1], m[2]);
      const unit = norm(m[3]);
      if (/^m|million/.test(unit)) v *= 1e6; else if (/^k/.test(unit)) v *= 1e3;
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 20);
      const perM2 = /^\s*(\/|par)\s*m/.test(after) || /\/\s*m²/.test(after);
      const before = lab + norm(t.slice(Math.max(0, m.index - 70), m.index)) + " " + norm(after);
      amounts.push({ v, perM2, before, line: i, raw: m[0] });
    }
    for (const m of t.matchAll(reSurf)) {
      const prev = t.slice(Math.max(0, m.index - 3), m.index);
      if (/€\s*\/?\s*$/.test(prev) || /\/\s*$/.test(prev)) continue;
      const v = toNumber(m[1], m[2]);
      if (v < 20) continue;
      const before = lab + norm(t.slice(Math.max(0, m.index - 60), m.index));
      const after = norm(t.slice(m.index + m[0].length, m.index + m[0].length + 30));
      let score = 0;
      if (/total|surface|superficie|sub\b|sul\b|gla|ensemble|utile|locative|developpe|immeuble/.test(before)) score += 3;
      if (/^\s*(de bureaux|bureaux|utile|total)/.test(after)) score += 1;
      if (/cour|terrasse|jardin|parking|archive|rooftop|plateaux? de|par plateau|niveau|etage|loge|cave|sous-sol|rdc|commerce de|lot de/.test(before + " " + after.slice(0, 12))) score -= 3;
      if (/dont\s*$/.test(before)) score -= 2;
      const next2 = [lines[i + 1], lines[i + 2]].filter((x) => x && x.page === l.page).map((x) => norm(x.text));
      const nextL = next2[0] || "";
      if (next2.some((x) => /^(surface|superficie|sub\b|gla)/.test(x) && !/\d/.test(x) && !/terrain/.test(x))) score += 3;
      if (l.size >= 13) score += 1;
      if (/^(r\s?[+-]\s?\d|rdc|rez|etage|niveau|sous-sol|ss\b)/.test(norm(t))) score -= 3;
      if (/^(surface du terrain|terrain|contenance|espaces exterieurs|parkings?)/.test(nextL)) score -= 4;
      surfaces.push({ v, score, line: i });
    }
  });
  const ctxAmt = (a) => ctxOf(a.line);

  surfaces.sort((a, b) => b.score - a.score || b.v - a.v);
  const surfU = surfaces.filter((x, j) => surfaces.findIndex((y) => y.v === x.v) === j);
  const surfC = surfU.slice(0, 6).map((s) => ({ value: s.v, label: fmtM2(s.v), ctx: ctxOf(s.line), loc: locOf(s.line) }));
  set("surf", surfC[0]?.value ?? "", surfC, surfaces.length && surfaces[0].score < 3 ? "verifier" : undefined);

  const isLoyer = (a) => /loyer|revenu|locatif|lfa|rent|ht\s*hc|valeur locative|vlm|erv|chiffres? d.affaires|\bca\b/.test(a.before);
  amounts.forEach((a) => {
    a.kind = /chiffres? d.affaires|\bca\b/.test(a.before) ? "CA" : /\bnets?\b|\bnoi\b/.test(a.before) ? "net" : /\bbruts?\b|facture/.test(a.before) ? "brut" : "";
  });
  const isVlm = (a) => /valeur locative|vlm|erv|potentiel|marche|apres travaux|cible|reversion/.test(a.before);
  const isPrix = (a) => /prix|valeur venale|cession|vente|aem|\bhd\b|hors droits|fai|acte en main|asking|price|offre/.test(a.before) && !isLoyer(a);
  const isCapex = (a) => /travaux|capex|budget|renovation|restructuration/.test(a.before) && !isLoyer(a);

  const ordreLoyer = { net: 0, "": 1, brut: 2, CA: 3 };
  const loy = amounts.filter((a) => isLoyer(a) && !a.perM2 && !isVlm(a) && a.v >= 10000).sort((a, b) => ordreLoyer[a.kind] - ordreLoyer[b.kind]);
  const vlm = amounts.filter((a) => isLoyer(a) && !a.perM2 && isVlm(a) && a.v >= 10000);
  const surfRef = Number(out.surf.value) || 0;
  const prix = amounts.filter((a) => isPrix(a) && !a.perM2 && a.v >= 300000 && !/chiffres? d.affaires|\bca\b|capital social|effectifs?\b|salaries/.test(a.before)
    && (!surfRef || (a.v / surfRef >= 500 && a.v / surfRef <= 60000)));
  const capex = amounts.filter((a) => isCapex(a) && !a.perM2 && a.v >= 10000);
  const cand = (arr) => arr.slice(0, 6).map((a) => ({ value: a.v, label: fmtEur(a.v) + (a.kind ? ` (${a.kind})` : ""), ctx: ctxAmt(a), loc: locOf(a.line) }));
  set("loyer", loy[0]?.v ?? "", cand(loy), loy.length && (loy[0].kind !== "net" || loy.some((a) => a.kind === "CA" || a.kind === "brut")) ? "verifier" : undefined);
  if (loy.length && loy[0].kind === "CA") out.loyer.note = "Seul un chiffre d'affaires a été trouvé : vérifie s'il s'agit d'un loyer ou de l'activité d'un exploitant.";
  else if (loy.some((a) => a.kind === "CA" || a.kind === "brut")) out.loyer.note = "Revenus nets retenus (base des taux de marché). Le brut / CA est dans les autres valeurs.";
  set("vlm", vlm[0]?.v ?? "", cand(vlm));
  const prixC = cand(prix);
  const fai = prix[0] && /fai|acte en main|aem/.test(prix[0].before) && !/rendement/.test(prix[0].before);
  set("prix", prix[0]?.v ?? "", prixC, fai ? "verifier" : undefined);
  if (fai) out.prix.note = "Prix acte en main (droits inclus) : la colonne attend un prix hors droits, à convertir.";
  if (!prix.length && /prix(\s+de cession|\s+demande|\s+de vente)?\s*:?\s*(nous consulter|a definir|non communique|sur demande|sur offre|nc\b)|prix non communique|sans prix affiche|offres? libres?/.test(nfull))
    out.prix.status = "nc";
  set("capex", capex[0]?.v ?? "", cand(capex), capex.length ? "verifier" : undefined);

  // ---- adresse, CP, ville
  const reAdr = /\b(\d{1,4}(?:\s?(?:bis|ter))?(?:\s?[-\/à]\s?\d{1,4}(?:\s?(?:bis|ter))?)?)[,\s]+((?:rue|avenue|av\.?|boulevard|bd|place|quai|allée|allee|impasse|cours|villa|passage|square|chemin|route|cité|cite|rond-point|esplanade|parvis|promenade)\b[^,\n–—|()]{2,45})/i;
  const adrC = [];
  lines.forEach((l, i) => {
    const m = l.text.match(reAdr);
    if (m) {
      let street = m[2].replace(/\s+(\d{5}|paris|-|–).*$/i, "").trim();
      street = street.replace(/\s+(\d{5}).*$/, "").replace(/\s+(dans|au|aux|à|a|en|pres|près|proche|située?s?|entre|offrant|comprenant|qui|avec)\s.*$/i, "").trim();
      street = street.replace(/^av\.?(?=\s)/i, "avenue").replace(/^bd\.?(?=\s)/i, "boulevard");
      const val = `${m[1].replace(/\s/g, "")} ${street}`;
      if (!adrC.some((c) => c.value === val)) adrC.push({ value: val, label: val, ctx: clip(l.text), page: l.page, i, loc: locOf(i), pied: repete(l) || /registre|siege social|capital de|rcs\b/.test(norm(l.text)) });
    }
  });
  const fixCase = (v) => (v === v.toUpperCase() ? v.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Rue|Avenue|Boulevard|Place|Quai|Allée|Impasse|Cours|Villa|Passage|Square|Chemin|Route|Cité|Des|De|Du|La|Le|Les)\b/g, (w) => w.toLowerCase()) : v);
  adrC.sort((a, b) => a.pied - b.pied || (a.value === a.value.toUpperCase()) - (b.value === b.value.toUpperCase()) || a.page - b.page);
  adrC.forEach((c) => { c.value = fixCase(c.value); c.label = c.value; });
  for (let i = adrC.length - 1; i > 0; i--) if (norm(adrC[i].value) === norm(adrC[0].value)) adrC.splice(i, 1);
  set("adr", adrC[0]?.value ?? "", adrC.slice(0, 5));

  const cpC = [];
  lines.forEach((l, li) => {
    let m;
    const reCp = /\b((?:75|77|78|91|92|93|94|95)\d{3})\b[\s,]*([A-Za-zÀ-ÿ' -]{2,40})?/g;
    while ((m = reCp.exec(l.text))) {
      const ville = (m[2] || "").split(/\s[-–]\s|\s{2,}/)[0].trim().replace(/\s+(cedex|france)$/i, "");
      cpC.push({ cp: m[1], ville: ville || (m[1].startsWith("75") ? "Paris" : ""), ctx: clip(l.text), loc: locOf(li) });
    }
    const p = l.text.match(/\bParis\s*(\d{1,2})\s*(?:e|er|è|ème|eme)(?![\p{L}])/iu) || l.text.match(/\b(\d{1,2})\s*(?:e|er|è|ème|eme)\s+arrondissement/i)
      || l.text.match(/\bParis\s+(\d{1,2})(?![\d,.:hH%]|\s*(?:m|min|minutes|km|ans?|mois|\/))/);
    if (p && +p[1] >= 1 && +p[1] <= 20) cpC.push({ cp: `750${p[1].padStart(2, "0")}`, ville: "Paris", ctx: clip(l.text), loc: locOf(li) });
    const rom = l.text.match(/\bParis\s+([IVX]{1,5})\b/);
    if (rom) { const n = romain(rom[1]); if (n >= 1 && n <= 20) cpC.push({ cp: `750${String(n).padStart(2, "0")}`, ville: "Paris", ctx: clip(l.text), loc: locOf(li) }); }
  });
  const cp0 = cpC[0];
  set("cp", cp0?.cp ?? "", cpC.slice(0, 5).map((c) => ({ value: c.cp, label: c.cp, ctx: c.ctx, loc: c.loc })));
  let ville = cp0 ? (cp0.cp.startsWith("75") ? "Paris" : cp0.ville) : "";
  ville = ville.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bSur\b/g, "sur").replace(/\bLes\b(?=-)/g, "les");
  set("ville", ville);
  set("secteur", secteurFromCp(cp0?.cp, ville), [], cp0 ? "verifier" : undefined);

  // ---- nom de projet : plus grand texte de la page 1 qui n'est ni une adresse ni un broker
  const p1 = lines.filter((l) => l.page <= 2 && l.text.length >= 3 && l.text.length <= 40);
  const generic = /^(paris|[a-z' -]+)\s+([ivx]{1,5}|\d{1,2}\s*(e|er|eme))$|avertissement|introduction|localisation|environnement|description|annexes?|plans?\b|conditions|points? cles|sommaire|teaser|confidenti|investissement|transaction|cession|a vendre|memorandum|memo|opportunite|synthese|caracteristiques|sommaire|presentation|immeuble|bureaux|contact|capital markets|introduction|executive|summary|dossier|page/;
  const brokerRe = listeBrokers(data).map((b) => b[1]);
  const nomC = p1
    .filter((l) => !reAdr.test(l.text) && !/\d{5}|[:%€]|m²/.test(l.text) && !generic.test(norm(l.text)) && !brokerRe.some((r) => r.test(norm(l.text))))
    .sort((a, b) => b.size - a.size)
    .slice(0, 4)
    .map((l) => ({ value: l.text.replace(/^[«"“]|[»"”]$/g, "").trim(), label: l.text, ctx: `page ${l.page}, taille ${Math.round(l.size)}`, loc: locOf(lines.indexOf(l)) }));
  const bodySize = median(lines.map((l) => l.size));
  const nomOk = nomC[0] && p1.find((l) => l.text === nomC[0].label)?.size >= bodySize * 1.6;
  const sansEsp = (x) => norm(x).replace(/[^a-z0-9]/g, "");
  const estAdresse = (x) => out.adr.value && sansEsp(out.adr.value).includes(sansEsp(x));
  const nomVal = nomOk && !estAdresse(nomC[0].value) ? capitalize(nomC[0].value) : "";
  set("nom", nomVal, nomC.map((c) => ({ ...c, value: capitalize(c.value) })), nomVal ? "verifier" : undefined);

  // ---- typologie
  const ntypo = norm(lines.filter((l) => !repete(l)).map((l) => l.text).join("\n"))
    .replace(/registre du commerce|fonds de commerce|chambre de commerce|commerces? (de proximite|et restaurants|et services)|(restaurants|services|boutiques),? (et )?commerces|proche commerces|hotel de ville|hotel particulier|cherche-midi/g, " ");
  const typoScore = {
    Bureaux: count(ntypo, /bureaux?|office|tertiaire|plateaux? (courants?|de bureaux|divisibles|en copro)|cowork/g),
    Logistique: count(ntypo, /logisti|entrepot|messagerie|plateforme logistique/g),
    "Locaux d'activité": count(ntypo, /locaux d.activite|batiment d.activite|activites? legere/g),
    Commerce: count(ntypo, /commerces?\b|retail|boutique|pied d.immeuble commercial/g),
    Résidentiel: count(ntypo, /logements?|residentiel|habitation|appartements?/g),
    Hôtellerie: count(ntypo, /hotel|hotellerie|para-hotel/g),
  };
  const typoSorted = Object.entries(typoScore).sort((a, b) => b[1] - a[1]).filter((x) => x[1] > 0);
  let typo = typoSorted[0]?.[0] || "";
  const mixteDit = /(ensemble|actif|programme|projet) (immobilier )?mixte|usage mixte/.test(ntypo);
  if (typoSorted[1] && typoSorted[0][1] >= 3 && (typoSorted[1][1] >= typoSorted[0][1] * 0.8 || (mixteDit && typoSorted[1][1] >= typoSorted[0][1] * 0.3))) typo = "Mixte";
  set("typo", typo, typoSorted.map(([k, n]) => ({ value: k, label: `${k} (${n} mentions)`, ctx: "" })), typo ? "verifier" : undefined);

  // ---- régime
  let regime = "";
  if (/propriete de volumes?|detenu en volumes?/.test(nfull)) regime = "Volumes";
  else if (/copropriete|copro\b|lots? de copro/.test(nfull)) regime = "Copropriété";
  else if (/volumes?\b.{0,20}(detenu|division)|division en volumes|detenu en volume|en volume|propriete de volumes?|lots? de volume/.test(nfull)) regime = "Volumes";
  else if (/bail a construction/.test(nfull)) regime = "Bail à construction";
  else if (/usufruit|nue-propriete|demembrement/.test(nfull)) regime = "Démembrement";
  else if (/pleine propriete|monopropriete|immeuble independant|mono-propriete/.test(nfull)) regime = "Pleine propriété";
  set("regime", regime);

  // ---- situation locative et occupation
  let occ = "", sit = "";
  const mo = nfull.match(/(?:taux d.occupation|occupe|loue)\D{0,25}(\d{1,3}(?:[,.]\d+)?)\s?%/) || nfull.match(/(\d{1,3}(?:[,.]\d+)?)\s?%\s*(?:loue|occupe|d.occupation)/);
  if (mo) occ = parseFloat(mo[1].replace(",", ".")) / 100;
  if (/vendu (libre|vide)|libre de toute occupation|livre vide|100\s?% vacant|entierement vacant|totalement vacant|immeuble vide|vacant a la vente|libre a la vente/.test(nfull)) { sit = "Vacant"; occ = 0; }
  else if (/mono[\s-]?locataire|un seul locataire|loue en totalite a|100\s?% loue a/.test(nfull)) sit = "Loué mono-locataire";
  else if (/multi-?locataires?|\b\d+\s+locataires/.test(nfull)) sit = occ !== "" && occ < 0.95 ? "Partiellement loué" : "Loué multi-locataires";
  else if (occ !== "") sit = occ >= 0.99 ? "Loué multi-locataires" : occ > 0 ? "Partiellement loué" : "Vacant";
  set("sitloc", sit, [], sit ? "verifier" : undefined);
  set("occ", occ);

  const mw = nfull.match(/walb\D{0,25}?(\d+(?:[,.]\d+)?)\s*(?:ans?\b|a\b|\/\s*\d+(?:[,.]\d+)?\s*(?:ans?|a)\b)/);
  set("walb", mw ? parseFloat(mw[1].replace(",", ".")) : "");

  // ---- dates
  const dl = [];
  lines.forEach((l, i) => {
    const d = parseDate(l.text);
    if (!d) return;
    const c = norm((lines[i - 1]?.text || "") + " " + l.text);
    const score = /offre|remise|limite|butoir|deadline|tour|round|avant le|candidature|date de reponse/.test(c) ? 2 : 0;
    dl.push({ value: d, label: d, ctx: clip(l.text), score, loc: locOf(i) });
  });
  dl.sort((a, b) => b.score - a.score);
  set("dl", dl[0]?.score ? dl[0].value : "", dl.slice(0, 5));

  // ---- apporteur et contact
  const bc = {};
  for (const [name, re] of listeBrokers(data)) {
    const n = count(nfull, new RegExp(re.source, "g"));
    if (n) bc[name] = (bc[name] || 0) + n;
  }
  const emails = [...new Set(full.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])];
  emails.forEach((e) => { for (const [name, re] of listeBrokers(data)) if (re.test(norm(e))) bc[name] = (bc[name] || 0) + 3; });
  const appC = Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ value: k, label: `${k} (${n})`, ctx: "" }));
  set("app", appC[0]?.value ?? "", appC);
  if (appC[0] && data?.Apporteurs?.length && !data.Apporteurs.includes(appC[0].value)) {
    out.app.status = "verifier";
    out.app.note = `« ${appC[0].value} » n'est pas dans ta liste Apporteurs : ajoute-le dans l'onglet Listes, sinon Excel refusera la valeur.`;
  }
  const pagesMail = [...new Set(lines.filter((l) => /@/.test(l.text)).map((l) => l.page))].map((p) => norm(lines.filter((l) => l.page === p).map((l) => l.text).join(" ")));
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contactsC = (data?.Contacts || [])
    .filter((c) => {
      if (!c.nom) return false;
      const parts = c.nom.split(" "), last = norm(parts.slice(1).join(" ")), first = norm(parts[0]);
      if (last.length < 3) return false;
      const hasLast = new RegExp(`\\b${esc(last)}\\b`).test(nfull);
      return hasLast && (new RegExp(`\\b${esc(first)}\\b`).test(nfull) || norm(c.societe || "") === norm(appC[0]?.value || ""));
    })
    .map((c) => {
      const last = norm(c.nom.split(" ").slice(1).join(" "));
      c._mail = pagesMail.some((t) => t.includes(last)) ? 1 : 0;
      return c;
    })
    .sort((a, b) => (b.societe === appC[0]?.value) - (a.societe === appC[0]?.value) || b._mail - a._mail)
    .map((c) => ({ value: c.nom, label: `${c.nom} (${c.societe})`, ctx: "" }));
  set("contact", contactsC[0]?.value ?? "", contactsC, contactsC.length ? "verifier" : undefined);

  // ---- mode
  let mode = "";
  if (/off[\s-]?market|hors marche/.test(nfull)) mode = "Off market";
  else if (/appel d.offres|consultation/.test(nfull)) mode = "Appel d'offres";
  else if (/process(us)? (restreint|cible)|restricted/.test(nfull)) mode = "Process restreint";
  else if (/process(us)? (large|ouvert)|broad/.test(nfull)) mode = "Process large";
  set("mode", mode);

  const mv = full.match(/(?:vendeur|propri[ée]taire)\s*:\s*([^.\n;]{2,60})/i);
  set("vendeur", mv ? mv[1].trim() : "", [], mv ? "verifier" : undefined);

  // ---- description : phrases techniques
  const techRe = /igh\b|etages?\b|construit|livre en|renove|restructur|r\+\d|sous-sols?|erp|hsp|hauteur|parkings?|terrasse|cour\b|rooftop|breeam|hqe|leed|dpe|plateaux?|haussmann|independant|patio|ascenseur|plu\b|amiante|fai\b|droits reduits|honoraires/;
  const dejaRanges = /surface\s*(totale|utile)?\s*:|loyer|taux d.occupation|prix|walb|walt|remise des offres|date limite|contacts?\s*:|@|\blocataires?\b|vendeur\s*:/;
  const sentences = full.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 260 && techRe.test(norm(s)) && !dejaRanges.test(norm(s)));
  const uniq = [...new Set(sentences)];
  const faits = [];
  const F = {};
  const an = nfull.match(/(construit|edifie|bati|livre)\s*(?:en|au cours de)?\s*((?:18|19|20)\d{2})/) || nfull.match(/()((?:18|19|20)\d{2})\s*\n\s*annee de construction/) || nfull.match(/()annee de construction\D{0,15}((?:18|19|20)\d{2})/);
  if (an) { faits.push(`${an[1] === "livre" ? "Livré" : "Construit"} en ${an[2]}`); F.annee = an[2]; F.livre = an[1] === "livre"; }
  const ren = nfull.match(/(?:renove|restructure|rehabilite)\w*\s*(?:en|au cours de)?\s*((?:19|20)\d{2})/);
  if (ren && (!an || ren[1] !== an[2])) { faits.push(`rénové en ${ren[1]}`); F.renov = ren[1]; }
  const niv = full.match(/\bR\s?-\s?(\d)\s*(?:au|à|a)\s*R\s?\+\s?(\d{1,2})/i) || full.match(/\bR\s?\+\s?(\d{1,2})\s*sur\s*(\d)\s*(?:niveaux? de )?sous-sols?/i);
  if (niv) { faits.push(/R\s?-/i.test(niv[0]) ? `R-${niv[1]} à R+${niv[2]}` : `R+${niv[1]} sur ${niv[2]} sous-sol(s)`); F.etages = /R\s?-/i.test(niv[0]) ? niv[2] : niv[1]; F.ssol = /R\s?-/i.test(niv[0]) ? niv[1] : niv[2]; }
  else {
    const r6 = [...full.matchAll(/\bR\s?\+\s?(\d{1,2})\b/g)].map((m) => +m[1]).sort((a, b) => b - a)[0];
    if (r6 != null) { faits.push(`R+${r6}`); F.etages = String(r6); }
    const ss = nfull.match(/(\d)\s*(?:niveaux? de )?sous-sols?/); if (ss) F.ssol = ss[1];
  }
  const pk = nfull.match(/(\d{1,4})\s*(?:unites? de |places? de )?parkings?/) || nfull.match(/(\d{1,4})\s*unites?\s*\n\s*parkings?/);
  if (pk && +pk[1] > 0 && +pk[1] < 2000) { faits.push(`${pk[1]} parking(s)`); F.parkings = +pk[1]; }
  const ext = [];
  for (const [re, lab] of [[/\bcour(?![a-zà-ü])\D{0,20}?(\d[\d\s]{0,6})\s?m²|(\d[\d\s]{0,6})\s?m²\s*(?:de\s)?cour(?![a-zà-ü])/, "cour"], [/terrasse\D{0,20}?(\d[\d\s]{0,6})\s?m²|(\d[\d\s]{0,6})\s?m²\s*(?:de\s)?terrasse/, "terrasse"], [/jardin\D{0,20}?(\d[\d\s]{0,6})\s?m²|(\d[\d\s]{0,6})\s?m²\s*(?:de\s)?jardin/, "jardin"], [/rooftop\D{0,20}?(\d[\d\s]{0,6})\s?m²|(\d[\d\s]{0,6})\s?m²\s*(?:de\s)?rooftop/, "rooftop"]]) {
    const m = full.toLowerCase().match(re); if (m) ext.push(`${lab} de ${(m[1] || m[2]).trim()} m²`);
  }
  if (ext.length) { faits.push(ext.join(", ")); F.ext = ext; }
  const asc = nfull.match(/(\d{1,2})\s*ascenseurs?/); if (asc) { faits.push(`${asc[1]} ascenseur(s)`); F.asc = +asc[1]; }
  const erp = full.match(/ERP\s*(?:de\s*)?(\d)(?:e|ème)?\s*cat[ée]gorie(?:\s*type\s*[A-Z])?/i); if (erp) { faits.push(erp[0].replace(/\s+/g, " ")); F.erp = erp[1]; }
  const hsp = full.match(/HSP\s*[>≥:de]*\s*\d[,.]?\d*\s?m/i); if (hsp) { faits.push(hsp[0]); const h = hsp[0].match(/\d[,.]?\d*/); if (h) F.hsp = h[0].replace(".", ","); }
  const cert = full.match(/\b(BREEAM|HQE|LEED|WELL)\b[^.\n,]{0,25}/); if (cert) { faits.push(cert[0].trim()); F.cert = cert[0].replace(/[«»"“”(].*$/, "").replace(/\s*[&/]\s*$/, "").trim(); }
  const dpe = full.match(/\bDPE\s*:?\s*([A-G])\b/); if (dpe) { faits.push(`DPE ${dpe[1]}`); F.dpe = dpe[1]; }
  if (/eicsp/.test(nfull)) F.eicsp = /exploite comme du bureau|exploite en bureaux?/.test(nfull);
  if (/sans autorisation d.urbanisme/.test(nfull)) F.sansAutorisation = true;
  if (/plub?.{0,40}transformation/.test(nfull)) F.pluTransfo = true;
  const libre = nfull.match(/libre de toute occupation (?:a compter du|au|a partir du|des le)\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/);
  if (libre) F.libreLe = libre[1].replace(/\./g, "/");
  if (/igh\b|immeuble de grande hauteur/.test(nfull) && !/non igh/.test(nfull)) F.igh = true;
  if (/haussmann/.test(nfull)) F.haussmann = true;
  if (/independant/.test(nfull)) F.independant = true;
  if (/surelevation/.test(nfull)) F.surelev = true;
  const tr = [];
  for (const m of full.matchAll(/m[ée]tro[^.\n]{0,30}?lignes?\s*(\d{1,2})(?:\s*(?:et|,|&)\s*(\d{1,2}))?|lignes?\s*(\d{1,2})(?:\s*(?:et|,|&)\s*(\d{1,2}))?\s*(?:du|de)\s*m[ée]tro/gi))
    for (const n of [m[1], m[2], m[3], m[4]]) if (n && +n <= 14 && !tr.includes("M" + n)) tr.push("M" + n);
  for (const m of full.matchAll(/\bRER\s*([A-E])\b/g)) if (!tr.includes("RER " + m[1])) tr.push("RER " + m[1]);
  if (tr.length) F.transports = tr.slice(0, 4);
  if (/eicsp/.test(nfull)) faits.unshift("EICSP" + (/exploite comme du bureau|exploite en bureaux?/.test(nfull) ? " exploité en bureaux" : ""));
  if (/sans autorisation d.urbanisme/.test(nfull)) faits.push("usage bureau sans autorisation d'urbanisme");
  if (/plub?.{0,40}transformation/.test(nfull)) faits.push("PLU ouvert à la transformation");
  const desc = faits.length ? faits.join(". ").replace(/\. ([a-z])/g, (m, c) => ". " + c.toUpperCase()) + "." : uniq.slice(0, 3).map((x) => x.replace(/^[•▪\-–*]\s*/, "").replace(/[.;,\s]+$/, "")).join(". ").slice(0, 500) + (uniq.length ? "." : "");
  set("comm", desc, uniq.slice(0, 8).map((s) => ({ value: s, label: clip(s, 80), ctx: s })), desc ? "verifier" : undefined);

  const angleC = [];
  [[/transformation|changement d.usage|conversion/, "Transformation / changement d'usage"],
   [/restructur/, "Restructuration lourde"], [/repositionn/, "Repositionnement"],
   [/relocation|a relouer|vacance|plateaux vacants|libere/, "Relocation des surfaces vacantes"],
   [/renovation|a renover|travaux de/, "Rénovation"]].forEach(([re, lab]) => { if (re.test(nfull)) angleC.push({ value: lab, label: lab, ctx: "" }); });
  set("angle", "", angleC);

  // ---- fiche d'une page (deck multi-opportunités) : en-tête, titre et chiffres clés en gros caractères
  if (opts.fiche) {
    const pg = lines;
    const longues = pg.filter((l) => l.text.length > 30);
    const body = median((longues.length >= 3 ? longues : pg).map((l) => l.size));
    // ligne de localisation : « Herblay-sur-Seine (95) / VEFA », « Paris 17ème / Value add », « Paris (75017) »
    const iEnt = pg.findIndex((l) => /opportunit|fiche/.test(norm(l.text)));
    const locL = pg.slice(iEnt + 1, iEnt + 3).find((l) => /^[A-ZÀ-Ý][\p{L}' -]+(\s*\(\d{2,5}\)|\s+\d{1,2}\s*(er|e|è|ème|eme)?)?\s*([\/–-]|$)/u.test(l.text));
    if (locL) {
      const gaucheTxt = locL.text.split(/\s[\/–]\s|\s-\s|\//)[0].trim();
      const m = gaucheTxt.match(/^(.*?)\s*(?:\((\d{2}|\d{5})\))?$/);
      let v = m[1].trim(), code = m[2] || "";
      const pa = v.match(/^paris\s*(\d{1,2})\s*(er|e|è|ème|eme)?$/i);
      if (pa) { code = `750${pa[1].padStart(2, "0")}`; v = "Paris"; }
      if (code.length === 5) set("cp", code, [{ value: code, label: code, ctx: locL.text, loc: locOf(lines.indexOf(locL)) }]);
      else if (!/^75/.test(out.cp.value)) set("cp", "", out.cp.candidates);
      if (v && v.length < 40) set("ville", v.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).replace(/-(Sur|Sous|Les|Le|La|En)-/g, (x) => x.toLowerCase()).replace(/^(.)/, (c) => c.toUpperCase()));
      set("secteur", secteurFromCp(out.cp.value || (code.length === 2 ? code + "000" : ""), out.ville.value), [], "verifier");
    }
    // titre : lignes en très gros caractères, hors mentions commerciales
    const titres = pg.filter((l) => l.size >= Math.max(22, body * 2.2) && !/exclusivit|^prive$|off.?market|capital markets/.test(norm(l.text)) && l !== locL && !/opportunit/.test(norm(l.text)));
    const typoMot = [[/^commerces?$/, "Commerce"], [/^(hotel|hotellerie|residence hoteliere)$/, "Hôtellerie"], [/^bureaux?$/, "Bureaux"], [/^(logistique|entrepot)$/, "Logistique"], [/^(activite|locaux d.activite)$/, "Locaux d'activité"], [/^(logements?|residentiel)$/, "Résidentiel"]];
    let adrT = "", nomT = [], typoT = "";
    for (const t of titres) {
      let txt = t.text;
      const ma = txt.match(reAdr);
      if (ma && !adrT) {
        let street = ma[2].replace(/\s+(\d{5}|paris|-|–).*$/i, "").trim().replace(/^av\.?(?=\s)/i, "avenue").replace(/^bd\.?(?=\s)/i, "boulevard");
        adrT = `${ma[1].replace(/\s/g, "")} ${street}`;
        txt = txt.replace(ma[0], " ");
      }
      for (let part of txt.split(/\s[-–]\s|\//).map((x) => x.trim()).filter((x) => x.length >= 2)) {
        const tm = typoMot.find(([re]) => re.test(norm(part)));
        if (tm) { if (!typoT) typoT = tm[1]; continue; }
        if (!/\d/.test(part) || /^\p{L}/u.test(part)) nomT.push(part);
      }
    }
    if (adrT) set("adr", adrT, [{ value: adrT, label: adrT, ctx: titres.map((t) => t.text).join(" / ") }, ...out.adr.candidates.filter((c) => norm(c.value) !== norm(adrT))]);
    const nomV = nomT.length ? capitalize(nomT.join(" - ")) : "";
    set("nom", nomV, nomV ? [{ value: nomV, label: nomV, ctx: "titre de la page" }] : [], nomV ? "verifier" : undefined);
    if (typoT) set("typo", typoT, [{ value: typoT, label: `${typoT} (titre)`, ctx: "" }, ...out.typo.candidates], "verifier");

    // chiffres clés
    const T = lireTuiles(pg, body);
    const cap = (tk) => T.legende(tk);
    const surfT = T.tokens.filter((x) => x.k === "surf").sort((a, b) => b.y - a.y || a.x - b.x)[0];
    if (surfT) set("surf", surfT.v, [{ value: surfT.v, label: fmtM2(surfT.v), ctx: surfT.ligne.text, loc: locOf(lines.indexOf(surfT.ligne)) }, ...out.surf.candidates.filter((c) => c.value !== surfT.v)]);
    const surfV = Number(out.surf.value) || 0;
    const vacT = T.tokens.filter((x) => x.k === "vac");
    const pctT = T.tokens.filter((x) => x.k === "pct").sort((a, b) => b.y - a.y || a.x - b.x)[0];
    let occT = "";
    if (pctT) {
      const vacPres = /vacant/.test(norm(pctT.seg)) || vacT.some((v) => Math.abs(v.x - pctT.x) < 70 && v.y <= pctT.y + 3 && v.y >= pctT.y - 45);
      occT = vacPres && !/lou|occup/.test(norm(pctT.seg)) ? Math.round(100 - pctT.v) / 100 : pctT.v / 100;
    } else if (vacT.length) occT = 0;
    if (occT !== "") {
      set("occ", occT, [], "verifier");
      const sitT = occT === 0 ? "Vacant" : occT < 0.95 ? "Partiellement loué" : /mono[\s-]?locataire|monolocataire/.test(nfull) ? "Loué mono-locataire" : /multi[\s-]?locataires?|\d+\s*locataires/.test(nfull) ? "Loué multi-locataires" : out.sitloc.value || "Loué multi-locataires";
      set("sitloc", sitT, [], "verifier");
    }
    const walbT = T.tokens.filter((x) => x.k === "dur" && /walb|walt/.test(norm(x.seg + " " + cap(x))))[0];
    if (walbT) set("walb", walbT.v, [], "verifier");
    const metr = T.tokens.find((x) => x.k === "amt" && x.v >= 30 && x.v <= 1500 && (x.perM2 || /metrique|\/\s*m/.test(norm(T.legende(x, true)))) && !/apres travaux|estimation|potentiel/.test(norm(T.legende(x, true))));
    const montants = T.tokens.filter((x) => x.k === "amt" && !x.perM2 && x.v >= 50000);
    const loyT = [], prixT = [], vlmT = [];
    for (const a of montants) {
      const seg = norm(a.seg), lg = norm(cap(a));
      const ratio = surfV ? a.v / surfV : 0;
      if (/fai|aem|\bhd\b|prix|^\s*[>≥]|^c\.|offre/.test(seg) || /prix|valeur/.test(lg) && !/loyer/.test(lg)) { prixT.push({ ...a, note: /fai|aem/.test(seg) ? "Prix acte en main (FAI)" : /^\s*[>≥]/.test(seg) ? "Prix plancher (« > »)" : "" }); continue; }
      if (ratio >= 1500) { prixT.push(a); continue; }
      if (/\/\s*an|annuel|effectif|ht\s*-?\s*hc|befa|revenu/.test(seg + " " + lg)) { loyT.push(a); continue; }
      if (metr && surfV && occT !== "" && occT < 0.8 && Math.abs(a.v - surfV * metr.v) / a.v < 0.25) { vlmT.push(a); continue; }
      if (ratio && ratio < 1500) loyT.push(a); else if (/loyer/.test(lg)) loyT.push(a);
    }
    const apresT = T.tokens.find((x) => x.k === "amt" && x.perM2 && x.v >= 50 && x.v <= 1500 && /apres travaux|estimation|potentiel|cible/.test(norm(T.legende(x, true))));
    if (apresT && surfV && !vlmT.length) {
      vlmT.push({ ...apresT, v: Math.round(apresT.v * surfV) });
    }
    const c1 = (a) => ({ value: a.v, label: fmtEur(a.v), ctx: a.ligne.text + (cap(a) ? " / " + cap(a) : ""), loc: locOf(lines.indexOf(a.ligne)) });
    if (loyT.length) set("loyer", loyT[0].v, [...loyT.map(c1), ...out.loyer.candidates], "verifier");
    if (vlmT.length) {
      set("vlm", vlmT[0].v, vlmT.map(c1), "verifier");
      out.vlm.note = vlmT[0].perM2 ? `Loyer estimé après travaux ${Math.round(apresT.v)} €/m²/an × ${fmtM2(surfV)}.` : "Montant cohérent avec surface × loyer métrique alors que l'actif est peu loué : probablement un loyer potentiel.";
    }
    if (prixT.length) { set("prix", prixT[0].v, [...prixT.map(c1), ...out.prix.candidates], prixT[0].note ? "verifier" : undefined); if (prixT[0].note) out.prix.note = prixT[0].note; }
  }

  // ---- état locatif
  const EL = lireEtatLocatif(lines);
  if (EL) {
    const note = (k, t) => { out[k].note = (out[k].note ? out[k].note + " " : "") + t; };
    const cEL = (v, lab) => ({ value: v, label: lab, ctx: `État locatif page ${EL.page}`, loc: EL.loc });
    if (EL.loyerTot) {
      if (out.loyer.value === "") { set("loyer", EL.loyerTot, [cEL(EL.loyerTot, fmtEur(EL.loyerTot) + " (état locatif)"), ...out.loyer.candidates], "verifier"); note("loyer", "Total des loyers de l'état locatif."); }
      else if (Math.abs(out.loyer.value - EL.loyerTot) > 1) out.loyer.candidates.unshift(cEL(EL.loyerTot, fmtEur(EL.loyerTot) + " (état locatif)"));
    }
    if (EL.walb != null) {
      if (out.walb.value === "") { set("walb", EL.walb, [cEL(EL.walb, `${EL.walb} ans (état locatif)`)], "verifier"); note("walb", `WALB tirée de l'état locatif (${EL.walbSource}), pondérée par les loyers.`); }
      else if (Math.abs(out.walb.value - EL.walb) > 0.05) out.walb.candidates = [cEL(EL.walb, `${EL.walb} ans (état locatif)`), ...(out.walb.candidates || [])];
    }
    if (out.occ.value === "" && EL.occ != null) set("occ", EL.occ, [], "verifier");
    if (!opts.fiche || out.sitloc.value === "") {
      const vac = EL.locataires.some((x) => x.vacant);
      const st = EL.nbLocataires === 0 ? "Vacant" : vac || (EL.occ != null && EL.occ < 0.95) ? "Partiellement loué" : EL.nbLocataires === 1 ? "Loué mono-locataire" : "Loué multi-locataires";
      set("sitloc", st, [], "verifier");
    }
    F.locataires = EL.locataires.filter((x) => !x.vacant).sort((a, b) => (b.loyer || b.surf || 0) - (a.loyer || a.surf || 0)).map((x) => nomSociete(x.nom));
    EL.locataires.forEach((x) => (x.nom = nomSociete(x.nom)));
  }

  // ---- description rédigée à partir des champs et des faits repérés
  const redac = rediger(Object.fromEntries(Object.entries(out).map(([k, c]) => [k, c.value])), F);
  if (redac) {
    set("comm", redac, [...(out.comm.candidates || [])], "verifier");
    out.comm.note = "Texte rédigé à partir des champs. Si tu corriges un champ, clique sur « Rédiger à nouveau ».";
  }

  const chercheLoc = (v) => {
    if (v === "" || v == null) return null;
    let re;
    if (typeof v === "number") {
      const ent = String(Math.round(v)); if (ent.length < 2) return null;
      re = new RegExp(ent.replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s\\u00a0\\u202f.]?"));
      if (v >= 1e6 && v % 1e5 === 0) re = new RegExp(`${re.source}|\\b${String(v / 1e6).replace(".", "[,.]")}\\s?M`);
    } else {
      const t = norm(String(v)).slice(0, 30); if (t.length < 3) return null;
      for (let i = 0; i < lines.length; i++) if (norm(lines[i].text).includes(t)) return locOf(i);
      return null;
    }
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i].text)) return locOf(i);
    return null;
  };
  for (const [k, c] of Object.entries(out)) {
    c.loc = c.candidates?.find((x) => String(x.value) === String(c.value))?.loc || chercheLoc(k === "occ" ? "" : c.value);
    for (const x of c.candidates || []) if (!x.loc) x.loc = chercheLoc(x.value);
  }
  const appRe = listeBrokers(data).find((b) => b[0] === out.app?.value)?.[1];
  const kw = {
    regime: /copropriete|copro\b|volumes?\b|bail a construction|usufruit|nue-propriete|pleine propriete|monopropriete|immeuble independant/,
    sitloc: /vendu (libre|vide)|libre de toute occupation|livre vide|vacant|mono-?locataire|monolocataire|multi-?locataires?|\d+\s+locataires|taux d.occupation/,
    occ: /taux d.occupation|\d\s?%\s*(loue|occupe)|libre de toute occupation|vacant/,
    mode: /off[\s-]?market|hors marche|appel d.offres|consultation|process/,
    walb: /walb/, app: appRe, typo: /bureaux?|logisti|entrepot|activite|commerce|logements?|hotel/,
  };
  for (const [k, re] of Object.entries(kw)) {
    const c = out[k];
    if (!re || !c || c.loc || c.value === "" || c.value == null) continue;
    const i = lines.findIndex((l) => re.test(norm(l.text)));
    if (i >= 0) c.loc = locOf(i);
  }
  const alertes = [];
  const nLoc = count(nfull, /surfaces? disponibles?|disponibilite|a louer\b|a la location|provision (de|sur) charges|franchise de loyer|loyer facial|bail a ceder/g);
  const nVente = count(nfull, /cession|a vendre|\bvente\b|acquisition|investisseurs?|rendement|prix de|offres? (ferme|indicative|engageante)|memorandum|teaser|capital markets/g);
  if (nLoc >= 4 && nLoc > 2 * nVente) {
    alertes.push("Ce document ressemble à une plaquette de location, pas à une mise en vente : vérifie avec le broker si l'immeuble est à vendre.");
    const lm = amounts.filter((a) => a.perM2 && a.v >= 50 && a.v <= 1500 && /loyer/.test(a.before)).sort((a, b) => b.v - a.v)[0];
    const sf = Number(out.surf.value) || 0;
    if (lm && sf && !out.loyer.value && !out.vlm.value) {
      set("vlm", Math.round(lm.v * sf), [{ value: Math.round(lm.v * sf), label: fmtEur(lm.v * sf), ctx: `${lm.raw} × ${fmtM2(sf)}`, loc: locOf(lm.line) }], "verifier");
      out.vlm.note = `Loyer de commercialisation ${Math.round(lm.v)} €/m²/an × ${fmtM2(sf)} : valeur locative annuelle estimée, à confirmer.`;
    }
  }
  if (out.loyer.value && out.surf.value && out.loyer.value / out.surf.value > 1500) alertes.push("Le loyer trouvé dépasse 1 500 €/m²/an : vérifie qu'il ne s'agit pas d'un prix.");
  set("date", todayFr());
  set("statut", "1 - Nouveau");
  for (const k of ["cible", "resp", "next", "motif", "path"]) if (!out[k]) set(k, "");
  return { champs: out, faits: F, etatLocatif: EL, emails, alertes, nbPages: pages.length, nbCaracteres: full.length, texte: full };
}

// ---------- état locatif : tableau des locataires
const TYPES_COL = [
  ["lm2", /(€|loyer)\s*\/\s*m|\/\s*m²|\/\s*m2|€\s*\/?\s*m²|par m²|au m²|^€\/m|^\/ ?m/],
  ["walb", /walb|duree residuelle ferme/], ["walt", /walt/],
  ["loyer", /loyer|rent\b|revenu/],
  ["surf", /surface|m²|m2\b|\bsub\b|carrez|gla|\bsdp\b|\bsul\b/],
  ["nom", /locataire|preneur|enseigne|occupant|tenant/],
  ["ech", /prochaine|echeance|break|resiliation|triennale|sortie/],
  ["fin", /\bfin\b|terme|expiration/],
  ["debut", /effet|debut|entree|prise|signature/],
  ["pk", /parking|places/], ["pct", /repartition|quote-part|%/], ["etage", /etage|niveau|lot\b/],
];
function lireEtatLocatif(lines, ref = new Date()) {
  const rangs = [];
  for (const l of lines) {
    if (!l.cells || l.x0 == null) continue;
    let r = rangs.find((x) => x.page === l.page && Math.abs(x.y - l.y) < Math.max(2.5, l.size * 0.45));
    if (!r) { r = { page: l.page, y: l.y, size: l.size, cells: [], line: l }; rangs.push(r); }
    r.cells.push(...l.cells); r.size = Math.max(r.size, l.size);
  }
  rangs.forEach((r) => r.cells.sort((a, b) => a.x0 - b.x0));
  rangs.sort((a, b) => a.page - b.page || b.y - a.y);
  const txt = (r) => norm(r.cells.map((c) => c.text).join(" "));
  const reNum = new RegExp(NUM);
  const nombre = (t) => { const m = String(t).match(new RegExp(`${NUM}${NB}*(M${NB}?€|k€|K€)?`)); if (!m) return null; let v = toNumber(m[1], m[2]); if (/m/i.test(m[3] || "")) v *= 1e6; else if (/k/i.test(m[3] || "")) v *= 1e3; return v; };
  for (let h = 0; h < rangs.length; h++) {
    const H = rangs[h], th = txt(H);
    if (!/locataire|preneur|enseigne|occupant|tenant/.test(th) || H.cells.length < 3) continue;
    const kw = [/surface|m²|\bsub\b|carrez/, /loyer/, /echeance|break|resiliation/, /\bfin\b|terme/, /effet|debut|entree|prise/, /walb|walt/].filter((re) => re.test(th)).length;
    if (kw < 2) continue;
    const cols = H.cells.map((c) => ({ x0: c.x0, x1: c.x1, t: c.text }));
    // lignes d'en-tête suivantes (sans chiffre)
    let j = h + 1;
    while (j < rangs.length && rangs[j].page === H.page && H.y - rangs[j].y < H.size * 2.6 && !/\d{2}/.test(rangs[j].cells.map((c) => c.text).join(" ").replace(/m²|m2/g, ""))) {
      for (const c of rangs[j].cells) {
        const k = cols.reduce((b, col, i) => { const d = Math.abs((col.x0 + col.x1) / 2 - (c.x0 + c.x1) / 2); return d < b.d ? { i, d } : b; }, { i: -1, d: 1e9 });
        if (k.i >= 0 && k.d < 80) cols[k.i].t += " " + c.text;
      }
      j++;
    }
    for (const c of cols) { const n = norm(c.t); c.type = (TYPES_COL.find(([, re]) => re.test(n)) || ["autre"])[0]; }
    if (!cols.some((c) => c.type === "nom") || !cols.some((c) => ["loyer", "surf"].includes(c.type))) continue;
    // une colonne de chaque type au plus (la première)
    const vus = new Set(); for (const c of cols) { if (c.type !== "autre" && vus.has(c.type)) c.type = "autre"; vus.add(c.type); }
    const colDe = (c) => {
      let best = -1, bo = 0;
      cols.forEach((col, i) => { const o = Math.min(col.x1, c.x1) - Math.max(col.x0, c.x0); if (o > bo) { bo = o; best = i; } });
      if (best < 0) { let d = 1e9; cols.forEach((col, i) => { const dd = Math.abs(col.x0 - c.x0); if (dd < d) { d = dd; best = i; } }); if (d > 70) best = -1; }
      return best;
    };
    const locs = []; let total = null, prevY = rangs[j - 1].y;
    for (; j < rangs.length; j++) {
      const R = rangs[j];
      if (R.page !== H.page || prevY - R.y > Math.max(70, R.size * 6)) break;
      const tr = txt(R);
      if (/^\*|^source|^nb ?:|valeur locative de marche/.test(tr)) break;
      const row = {};
      for (const c of R.cells) { const i = colDe(c); if (i >= 0) row[cols[i].type] = (row[cols[i].type] ? row[cols[i].type] + " " : "") + c.text; }
      const n = { nom: (row.nom || "").trim() };
      if (row.surf) n.surf = nombre(row.surf);
      if (row.loyer) n.loyer = nombre(row.loyer);
      if (row.lm2) n.lm2 = nombre(row.lm2);
      for (const k of ["ech", "fin", "debut"]) if (row[k]) n[k] = parseDate(row[k]);
      for (const k of ["walb", "walt"]) if (row[k]) { const m = row[k].match(/\d+(?:[,.]\d+)?/); if (m) n[k] = parseFloat(m[0].replace(",", ".")); }
      const aChiffre = n.surf || n.loyer || n.ech || n.fin;
      if (/^total|^sous-total|^ensemble/.test(norm(n.nom || tr))) { total = n; prevY = R.y; break; }
      if (!aChiffre) {
        // nom sur deux lignes, ou fin du tableau
        if (n.nom && locs.length && !/\d/.test(tr) && prevY - R.y < R.size * 1.8) { locs[locs.length - 1].nom += " " + n.nom; prevY = R.y; continue; }
        if (locs.length) break; else continue;
      }
      if (!n.nom || !/\p{L}{2}/u.test(n.nom)) { if (locs.length) break; else continue; }
      n.vacant = /vacant|libre|disponible|vide\b|a louer/.test(norm(n.nom));
      n.loc = { page: R.page, x0: R.cells[0].x0, x1: R.cells[R.cells.length - 1].x1, y: R.y, h: R.size };
      locs.push(n); prevY = R.y;
    }
    if (!locs.length) continue;
    // calculs
    const occupes = locs.filter((x) => !x.vacant);
    const sLoyer = occupes.reduce((a, x) => a + (x.loyer || 0), 0);
    const loyerTot = total?.loyer || sLoyer || null;
    const sSurf = locs.reduce((a, x) => a + (x.surf || 0), 0), sOcc = occupes.reduce((a, x) => a + (x.surf || 0), 0);
    const surfTot = total?.surf || sSurf || null;
    const occ = locs.some((x) => x.vacant) && surfTot ? Math.round((sOcc / surfTot) * 1000) / 1000 : occupes.length ? 1 : 0;
    const enAns = (d) => { if (!d) return null; const [jj, mm, aa] = d.split("/").map(Number); return Math.max(0, (new Date(aa, mm - 1, jj) - ref) / (365.25 * 864e5)); };
    const moyenne = (val) => {
      const v = occupes.map((x) => ({ v: val(x), p: x.loyer || x.surf || 1 })).filter((x) => x.v != null);
      if (!v.length) return null;
      const pt = v.reduce((a, x) => a + x.p, 0);
      return Math.round((v.reduce((a, x) => a + x.v * x.p, 0) / pt) * 100) / 100;
    };
    let walb = moyenne((x) => x.walb ?? null), walbSource = "colonne WALB du tableau";
    if (walb == null) {
      walb = moyenne((x) => { const e = enAns(x.ech); return e > 0 ? e : enAns(x.fin); });
      walbSource = `prochaines échéances, calculée au ${String(ref.getDate()).padStart(2, "0")}/${String(ref.getMonth() + 1).padStart(2, "0")}/${ref.getFullYear()}`;
    }
    let walt = moyenne((x) => x.walt ?? null);
    if (walt == null) walt = moyenne((x) => enAns(x.fin));
    return { locataires: locs, total, loyerTot, surfTot, occ, walb, walbSource, walt, nbLocataires: occupes.length, page: H.page, colonnes: cols.map((c) => c.type), loc: { page: H.page, x0: H.cells[0].x0, x1: H.cells[H.cells.length - 1].x1, y: H.y, h: H.size } };
  }
  return null;
}
const nomSociete = (s) => (s === s.toUpperCase() ? s.split(/\s+/).map((w) => (/^([A-Z]\.?){1,4}$|^[A-Z&]{1,3}$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ") : s);

// ---------- doublons : comparaison d'adresses et de noms avec la Base
const VOIES = { av: "avenue", "av.": "avenue", bd: "boulevard", "bd.": "boulevard", blvd: "boulevard", r: "rue", "r.": "rue", pl: "place", "pl.": "place", st: "saint", ste: "sainte", fg: "faubourg", "fbg": "faubourg", "q.": "quai", imp: "impasse", all: "allee", sq: "square", pass: "passage", ch: "chemin", rte: "route", gal: "general", mal: "marechal", pdt: "president" };
export function cleAdresse(adr) {
  if (!adr) return null;
  let t = norm(String(adr)).replace(/[’']/g, " ").replace(/,/g, " ");
  const m = t.match(/^\s*(\d{1,4})\s*(?:bis|ter|b\b)?\s*(?:[-\/àa]\s*|et\s+)?(\d{1,4})?\s*(?:bis|ter)?\b(.*)$/);
  let n1 = null, n2 = null, rue = t;
  if (m) { n1 = +m[1]; n2 = m[2] ? +m[2] : n1; rue = m[3]; if (n2 < n1 || n2 - n1 > 40) n2 = n1; }
  rue = rue.split(/\s+/).map((w) => VOIES[w] || w).filter((w) => w && !/^(de|du|des|la|le|les|l|d|et|a)$/.test(w)).join(" ")
    .replace(/\b(paris|\d{5}).*$/, "").replace(/[^a-z0-9 ]/g, "").trim();
  return rue.length >= 3 ? { n1, n2, rue } : null;
}
const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
export function memeAdresse(a, b) {
  const A = cleAdresse(a), B = cleAdresse(b);
  if (!A || !B) return false;
  const rueOk = A.rue === B.rue || (Math.min(A.rue.length, B.rue.length) >= 8 && distance(A.rue, B.rue) <= 2);
  if (!rueOk) return false;
  if (A.n1 == null || B.n1 == null) return "rue";
  return A.n1 <= B.n2 && B.n1 <= A.n2 ? "adresse" : false;
}
export function chercherDoublons(d, base) {
  const res = [];
  const nomD = norm(d.nom || "").replace(/[^a-z0-9]/g, "");
  for (const r of base) {
    const cpOk = !d.cp || !r.cp || String(r.cp).trim() === String(d.cp).trim();
    const villeOk = !d.ville || !r.ville || norm(r.ville) === norm(d.ville);
    const ad = memeAdresse(d.adr, r.adr);
    const nomR = norm(r.nom || "").replace(/[^a-z0-9]/g, "");
    const nomOk = nomD.length >= 4 && nomR.length >= 4 && (nomD === nomR || (Math.min(nomD.length, nomR.length) >= 6 && (nomD.includes(nomR) || nomR.includes(nomD))));
    if (ad === "adresse" && cpOk && villeOk) res.push({ ...r, raison: "même adresse", fort: true });
    else if (nomOk && cpOk) res.push({ ...r, raison: "même nom de projet", fort: true });
    else if (ad === "rue" && cpOk && villeOk) res.push({ ...r, raison: "même rue, numéro absent", fort: false });
  }
  return res;
}
// lit un copier-coller de la Base (avec ou sans ligne d'en-tête)
export function lireBaseCollee(t) {
  const rows = String(t).split(/\r?\n/).map((l) => l.split("\t"));
  let idx = { statut: 0, date: 2, nom: 3, adr: 4, cp: 5, ville: 6 }, debut = 0;
  const h = rows.findIndex((r) => r.some((c) => /^adresse/i.test(c.trim())));
  if (h >= 0) {
    const f = (re) => rows[h].findIndex((c) => re.test(norm(c.trim())));
    idx = { statut: f(/^statut/), date: f(/^date de reception|^date/), nom: f(/^nom/), adr: f(/^adresse/), cp: f(/^cp$|code postal/), ville: f(/^ville/) };
    debut = h + 1;
  } else {
    const n = Math.max(...rows.map((r) => r.length));
    if (n === 2) idx = { nom: 0, adr: 1 }; else if (n === 1) idx = { adr: 0 }; else if (n < 7) idx = { nom: 0, adr: 1, cp: 2, ville: 3 };
  }
  const g = (r, k) => (idx[k] != null && idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
  return rows.slice(debut).map((r, i) => ({ ligne: i + 1, statut: g(r, "statut"), date: g(r, "date"), nom: g(r, "nom"), adr: g(r, "adr"), cp: g(r, "cp"), ville: g(r, "ville") }))
    .filter((r) => r.adr || r.nom);
}

// ---------- mail : expéditeur, date, et fusion avec les PDF joints
// Domaines de messagerie de ton entreprise : un mail venant de ces adresses (transfert d'un collègue)
// n'est pas pris pour un mail de broker. Remplace « monentreprise » par ton domaine.
const INTERNE = /monentreprise\.example/i;
function expediteurs(info) {
  const liste = [];
  if (info.deMail || info.deNom) liste.push({ nom: info.deNom || "", mail: info.deMail || "", date: info.date || null });
  // en-têtes de messages transférés dans le corps
  const t = String(info.texte || "");
  const re = /^[ \t>]*(?:De|From)\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(t))) {
    const v = m[1].trim(), a = v.match(/^"?([^"<\[]*?)"?\s*[<\[](?:mailto:)?([^>\]]+)[>\]]/);
    const suite = t.slice(m.index, m.index + 400);
    const env = suite.match(/^[ \t>]*(?:Envoy[ée]|Sent|Date)\s*:\s*(.+)$/im);
    liste.push({ nom: a ? a[1].trim() : v.replace(/[\w.+-]+@[\w.-]+/, "").trim(), mail: a ? a[2].trim() : (v.match(/[\w.+-]+@[\w.-]+/) || [""])[0], dateTxt: env ? env[1] : "" });
  }
  return liste;
}
export function infosMail(info, data) {
  const exps = expediteurs(info);
  const ext = exps.find((e) => !INTERNE.test(e.mail) && (e.mail || e.nom)) || null;
  const r = { expediteur: ext, interne: !!exps.length && !INTERNE.test(exps[0].mail) ? false : true };
  // date de réception : date d'envoi par le broker si le mail a été transféré, sinon date du mail
  let d = null;
  if (ext?.dateTxt) d = parseDate(ext.dateTxt);
  if (!d && info.date) { const x = info.date; d = `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`; }
  r.date = d;
  if (ext) {
    const n = norm(`${ext.nom} ${ext.mail}`);
    const LB = listeBrokers(data);
    r.app = (LB.find(([, re]) => re.test(norm(ext.mail))) || LB.find(([, re]) => re.test(n)) || [])[0] || "";
    const parts = (c) => { const p = norm(c.nom).split(/\s+/); return { first: p[0], last: p.slice(1).join(" ") }; };
    const local = norm(ext.mail.split("@")[0]).replace(/[^a-z]/g, "");
    const c = (data?.Contacts || []).find((c) => { if (!c.nom) return false; const { first, last } = parts(c); const l = last.replace(/[^a-z]/g, ""); return l.length >= 3 && ((n.includes(first) && n.includes(last)) || (local.includes(l) && local.includes(first.slice(0, 1)))); });
    r.contact = c ? c.nom : ext.nom ? ext.nom.replace(/\s+/g, " ") : "";
    r.contactConnu = !!c;
    if (!r.app && c) r.app = c.societe || "";
  }
  return r;
}
export function fusionnerMail(resPdf, resMail, info, data, opts = {}) {
  const im = infosMail(info, data);
  const base = resPdf || resMail;
  const out = base.champs;
  const M = resMail?.champs || {};
  const vide = (c) => !c || c.value === "" || c.value == null;
  const deMail = (k, note) => {
    const c = M[k];
    const avant = out[k];
    out[k] = { ...c, candidates: [...(c.candidates || []).map((x) => ({ ...x, label: x.label + " (mail)" })), ...((avant?.candidates || []).filter((x) => String(x.value) !== String(c.value)))], status: "verifier", note };
    if (avant && !vide(avant) && String(avant.value) !== String(c.value)) out[k].candidates.push({ value: avant.value, label: `${avant.value} (PDF)`, ctx: "lu dans le PDF", loc: avant.loc });
    out[k].loc = null;
  };
  if (resPdf && resMail) {
    const prioritaires = opts.unSeulActif ? ["prix", "dl", "mode", "vendeur"] : ["dl", "mode"];
    for (const k of Object.keys(M)) {
      if (["date", "statut", "comm", "app", "contact"].includes(k)) continue;
      if (!opts.unSeulActif && !["dl", "mode", "vendeur"].includes(k)) continue;
      const c = M[k];
      if (vide(c)) continue;
      if (prioritaires.includes(k)) { if (vide(out[k]) || String(out[k].value) !== String(c.value)) deMail(k, vide(out[k]) ? "Lu dans le mail." : "Lu dans le mail, qui est plus récent que le PDF : la valeur du PDF reste proposée à côté."); }
      else if (vide(out[k])) deMail(k, "Lu dans le mail.");
    }
    if (out.prix?.status === "nc" && !vide(M.prix)) deMail("prix", "Lu dans le mail.");
  }
  if (im.date) { out.date = { value: im.date, candidates: [], status: "trouve", note: "Date du mail du broker." }; }
  if (im.app) out.app = { value: im.app, candidates: [{ value: im.app, label: im.app + " (expéditeur)", ctx: im.expediteur?.mail || "" }, ...((out.app?.candidates) || []).filter((x) => x.value !== im.app)], status: "trouve", note: "D'après l'adresse de l'expéditeur." };
  if (im.contact) out.contact = { value: im.contact, candidates: [{ value: im.contact, label: im.contact + " (expéditeur)", ctx: im.expediteur?.mail || "" }, ...((out.contact?.candidates) || []).filter((x) => x.value !== im.contact)], status: im.contactConnu ? "trouve" : "verifier", note: im.contactConnu ? "Expéditeur du mail." : "Expéditeur du mail, absent de tes contacts brokers." };
  if (im.app && data?.Apporteurs?.length && !data.Apporteurs.includes(im.app)) { out.app.status = "verifier"; out.app.note = `« ${im.app} » n'est pas dans ta liste Apporteurs : ajoute-le dans l'onglet Listes.`; }
  // description réécrite avec les champs fusionnés
  const F = { ...(resMail?.faits || {}), ...(resPdf?.faits || {}) };
  const txt = rediger(Object.fromEntries(Object.entries(out).map(([k, c]) => [k, c?.value ?? ""])), F);
  if (txt) out.comm = { ...(out.comm || {}), value: txt, status: "verifier", note: "Texte rédigé à partir des champs. Si tu corriges un champ, clique sur « Rédiger à nouveau »." };
  const entete = [`Mail : ${info.sujet || "(sans objet)"}`, `De : ${[info.deNom, info.deMail && `<${info.deMail}>`].filter(Boolean).join(" ")}`, info.date ? `Date : ${info.date.toLocaleString("fr-FR")}` : ""].filter(Boolean).join("\n");
  return {
    ...base, champs: out, faits: F, mail: { sujet: info.sujet, de: info.deNom || info.deMail, expediteur: im.expediteur },
    alertes: [...(resPdf?.alertes || []), ...(resMail && resPdf ? [] : resMail?.alertes || [])],
    texte: `${entete}\n\n${info.texte || ""}${resPdf ? "\n\n========== PDF joint ==========\n\n" + resPdf.texte : ""}`,
    nbCaracteres: (resPdf?.nbCaracteres || 0) + (resMail?.nbCaracteres || 0),
  };
}
// texte du mail -> lignes pour extraire()
export function lignesMail(info) {
  return [[info.sujet || "", ...String(info.texte || "").split(/\r?\n/)].filter((l) => l.trim()).map((t) => ({ text: t, size: 10 }))];
}

// ---------- mise à jour des listes : onglet Listes copié depuis Excel, et contacts brokers
export function lireListesCollees(t, cles) {
  const rows = String(t).split(/\r?\n/).map((l) => l.split("\t").map((c) => c.trim()));
  const h = rows.findIndex((r) => r.filter((c) => cles.includes(c)).length >= 3);
  if (h < 0) return null;
  const res = {};
  rows[h].forEach((c, j) => {
    if (!cles.includes(c)) return;
    const vals = [];
    for (const r of rows.slice(h + 1)) { const v = (r[j] || "").trim(); if (v && !vals.includes(v)) vals.push(v); }
    if (vals.length) res[c] = vals;
  });
  return res;
}
export function lireContactsColles(t) {
  const rows = String(t).split(/\r?\n/).map((l) => l.split("\t").map((c) => c.trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const h = rows.findIndex((r) => r.some((c) => /^(soci[ée]t[ée]|broker|apporteur|entreprise)$/i.test(c)));
  let iS = 0, iN = 1, iP = -1, debut = 0;
  if (h >= 0) {
    const f = (re) => rows[h].findIndex((c) => re.test(norm(c)));
    iS = f(/^(societe|broker|apporteur|entreprise)$/); iP = f(/^prenom$/); iN = f(/^(nom|nom complet|contact|nom du contact)$/);
    if (iN < 0) iN = f(/nom/);
    debut = h + 1;
  }
  return rows.slice(debut).map((r) => ({ societe: r[iS] || "", nom: [iP >= 0 ? r[iP] : "", r[iN] || ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() }))
    .filter((c) => c.societe && c.nom && c.nom.split(" ").length >= 2);
}

// ---------- rédaction de la description par gabarit (aucune IA : phrases fixes complétées par les valeurs)
const nbFr = (v, d = 0) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d });
const lister = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1]);
const de = (x) => (/^(un|une)\b/.test(x) ? "d'" + x : /^[aeiouyéèh]/i.test(x) ? "d'" + x : "de " + x);
export function rediger(v, F = {}) {
  const num = (x) => (x === "" || x == null || isNaN(Number(x)) ? null : Number(x));
  const surf = num(v.surf), occ = num(v.occ), walb = num(v.walb);
  const typo = v.typo || "", reg = v.regime || "";
  // lieu
  let lieu = "";
  if (v.cp && /^75\d{3}$/.test(v.cp)) { const a = +v.cp.slice(3); lieu = `Paris ${a}${a === 1 ? "er" : "e"}`; }
  else if (v.ville) lieu = v.ville + (v.cp ? ` (${v.cp})` : "");
  const ou = [v.adr, lieu].filter(Boolean).join(", ");
  const usage = { Bureaux: "bureaux", Commerce: "commerce", Hôtellerie: "hôtellerie", Résidentiel: "logements", Logistique: "logistique", "Locaux d'activité": "locaux d'activité", Mixte: "usage mixte" }[typo];
  const nomPP = { Bureaux: "Immeuble de bureaux", Commerce: "Local commercial", Hôtellerie: "Hôtel", Résidentiel: "Immeuble résidentiel", Logistique: "Entrepôt logistique", "Locaux d'activité": "Bâtiment d'activité", Mixte: "Immeuble mixte" }[typo] || "Immeuble";
  const S = [];
  const m2 = surf ? `${nbFr(surf)} m²` : "";
  // 1. nature, surface, détention, adresse
  if (reg === "Copropriété" || reg === "Volumes") {
    const det = reg === "Copropriété" ? "en copropriété" : "détenus en volumes";
    S.push(m2 ? `${m2}${usage ? " de " + usage : ""} ${det}${ou ? ", " + ou : ""}.` : `Lots${usage ? " de " + usage : ""} ${det}${ou ? ", " + ou : ""}.`);
  } else {
    let t = nomPP;
    if (F.haussmann && /^Immeuble/.test(t)) t += " haussmannien";
    if (F.igh) t = typo === "Bureaux" ? "Tour de bureaux" : "Immeuble de grande hauteur";
    if (m2) t += ` de ${m2}`;
    if (reg === "Pleine propriété") t += F.independant ? ", indépendant et en pleine propriété" : " en pleine propriété";
    else if (reg === "Bail à construction") t += " sous bail à construction";
    S.push(`${t}${ou ? (reg ? ", situé " : " situé ") + (v.adr ? "" : "à ") + ou : ""}.`);
  }
  // 2. bâti
  const bat = [];
  if (F.annee) bat.push(`${F.livre ? "livré" : "construit"} en ${F.annee}`);
  if (F.renov) bat.push(`rénové en ${F.renov}`);
  let elev = "";
  if (F.etages) elev = `R+${F.etages}` + (F.ssol ? ` sur ${F.ssol} niveau${+F.ssol > 1 ? "x" : ""} de sous-sol` : "");
  if (bat.length && elev) S.push(`L'immeuble, ${lister(bat)}, s'élève en ${elev}.`);
  else if (bat.length) S.push(`L'immeuble a été ${lister(bat)}.`);
  else if (elev) S.push(`L'immeuble s'élève en ${elev}.`);
  // 3. équipements
  const eq = [];
  if (F.parkings) eq.push(`${F.parkings} place${F.parkings > 1 ? "s" : ""} de parking`);
  for (const e of F.ext || []) { const x = e.replace(/^rooftop/, "toiture-terrasse"); eq.push((/^jardin/.test(x) ? "un " : "une ") + x); }
  if (F.asc) eq.push(F.asc === 1 ? "un ascenseur" : `${F.asc} ascenseurs`);
  if (F.hsp) eq.push(`une hauteur sous plafond de ${F.hsp} m`);
  if (eq.length) S.push(`Il dispose ${lister(eq.map(de))}.`);
  const tech = [];
  if (F.cert) tech.push(`certification ${F.cert}`);
  if (F.dpe) tech.push(`DPE ${F.dpe}`);
  if (F.erp) tech.push(`ERP de ${F.erp}e catégorie`);
  if (tech.length) S.push(tech.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".");
  // 4. situation locative
  const w = walb ? `, avec une WALB de ${nbFr(walb, 2)} an${walb >= 2 ? "s" : ""}` : "";
  if (F.libreLe) S.push(`L'actif sera libre de toute occupation au ${F.libreLe}.`);
  else if (v.sitloc === "Vacant" || occ === 0) S.push("L'actif est vendu vide.");
  else if (v.sitloc === "Loué mono-locataire") S.push(`Il est loué à un locataire unique${w}.`);
  else if (occ != null && occ < 0.99) S.push(`Il est loué à ${nbFr(occ * 100)} %${w}.`);
  else if (v.sitloc === "Loué multi-locataires" || occ != null) S.push(`Il est entièrement loué${v.sitloc === "Loué multi-locataires" ? " à plusieurs locataires" : ""}${w}.`);
  if (F.locataires?.length) {
    const L = F.locataires.slice(0, 3);
    S.push(F.locataires.length === 1 ? `Locataire : ${L[0]}.` : `${F.locataires.length > 3 ? "Principaux locataires" : "Locataires"} : ${lister(L)}.`);
  }
  // 5. urbanisme et potentiel
  if (F.eicsp != null) S.push(`Les surfaces sont classées en EICSP${F.eicsp ? " et exploitées en bureaux" : ""}${F.sansAutorisation ? ", sans autorisation d'urbanisme pour l'usage bureau" : ""}.`);
  if (F.pluTransfo) S.push("Le PLU permet la transformation.");
  if (F.surelev) S.push("Une surélévation est possible.");
  // 6. desserte
  if (F.transports) {
    const met = F.transports.filter((t) => /^M/.test(t)).map((t) => t.slice(1)).sort((a, b) => a - b), rer = F.transports.filter((t) => /^RER/.test(t));
    const parts = [];
    if (met.length) parts.push(`métro ligne${met.length > 1 ? "s" : ""} ${lister(met)}`);
    if (rer.length) parts.push(lister(rer));
    S.push(`Desserte : ${parts.join(", ")}.`);
  }
  return S.length > 1 || surf ? S.join(" ") : "";
}

// chiffres clés en gros caractères (bandeau de tuiles d'un one pager)
function lireTuiles(lines, body) {
  const seuil = Math.max(15, body * 1.6);
  const grosses = lines.filter((l) => l.size >= seuil && l.size < 30 && l.x0 != null);
  const re = new RegExp(`(${NUM}${NB}*m²(?!${NB}*\\/))|((?:[>≥~]|c\\.|env\\.?)?${NB}*${NUM}${NB}*(?:K€|k€|M€|m€|€)(?:${NB}*\\/${NB}*m²?)?(?:${NB}*\\/${NB}*an)?)|(${NUM}${NB}*%)|((?<![\\/\\d,.])${NUM}${NB}*(?:ans?|a)\\b(?:${NB}*\\/${NB}*${NUM}${NB}*(?:ans?|a)\\b)?)|(vacant)`, "gi");
  const tokens = [];
  for (const l of grosses) {
    const ms = [...l.text.matchAll(re)];
    ms.forEach((m, j) => {
      const deb = m.index, fin = m.index + m[0].length;
      const segFin = ms[j + 1] ? ms[j + 1].index : l.text.length;
      const segDeb = j ? ms[j - 1].index + ms[j - 1][0].length : 0;
      const seg = l.text.slice(segDeb, segFin);
      const x = l.x0 + ((l.x1 - l.x0) * (deb + fin) / 2) / Math.max(1, l.text.length);
      const n = m[0].match(new RegExp(NUM));
      let v = n ? toNumber(n[1], n[2]) : 0, k;
      if (m[1]) k = "surf";
      else if (m[4]) k = "amt";
      else if (m[7]) k = "pct";
      else if (m[10]) k = "dur";
      else k = "vac";
      const tk = { k, v, x, y: l.y, ligne: l, seg, raw: m[0] };
      if (k === "amt") {
        if (/m€|millions?/i.test(m[0]) && !/k€/i.test(m[0])) tk.v = v * 1e6; else if (/k€/i.test(m[0])) tk.v = v * 1e3;
        tk.perM2 = /\/\s*m/.test(m[0]) || /^\s*\/\s*m/.test(l.text.slice(fin));
      }
      tokens.push(tk);
    });
  }
  // légende : petites lignes et libellés sans chiffre, sous ou juste au-dessus du chiffre, dans la même colonne
  const legende = (tk, brute) => lines.filter((o) => o !== tk.ligne && o.x0 != null && o.y <= tk.y + 30 && o.y >= tk.y - 45
      && Math.max(0, o.x0 - tk.x, tk.x - o.x1) < 60 && (o.size < seuil || !re.test(o.text.replace(/vacant/gi, ""))) && (re.lastIndex = 0, true)
      && (brute || !/m[eé]trique|\/\s*m²?\)?\s*$|\(\/m²/i.test(o.text)))
    .map((o) => o.text).join(" ");
  return { tokens, legende };
}

// découpe un deck qui présente une opportunité par page, sinon un seul dossier
export function analyserDocument(pages, data) {
  const reFiche = /opportunite d.investissement|investment opportunity|fiche (actif|produit|opportunite)/;
  const idx = pages.map((pg, i) => (reFiche.test(norm(pg.slice(0, 4).map((l) => l.text).join(" "))) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return [extraire(pages, data)];
  const global = extraire(pages, data);
  return idx.map((i) => {
    const r = extraire(pages.map((pg, j) => (j === i ? pg : [])), data, { fiche: true });
    for (const k of ["app", "contact", "mode", "vendeur", "dl"]) if (!r.champs[k]?.value && global.champs[k]?.value) r.champs[k] = global.champs[k];
    r.emails = global.emails; r.nbPages = pages.length; r.pageSource = i + 1; r.nbFiches = idx.length;
    return r;
  });
}

function romain(r) { const v = { I: 1, V: 5, X: 10 }; let n = 0; for (let i = 0; i < r.length; i++) { const a = v[r[i]], b = v[r[i + 1]] || 0; n += a < b ? -a : a; } return n; }
function count(s, re) { return (s.match(re) || []).length; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 10; }
function capitalize(s) { return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s; }
function todayFr() { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; }

// reconstitue des lignes à partir du contenu texte pdf.js
export function lignesPdfjs(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4], size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    let r = rows.find((r) => Math.abs(r.y - y) < size * 0.5);
    if (!r) { r = { y, items: [], size: 0 }; rows.push(r); }
    let str = it.str;
    // texte espacé lettre par lettre (« P a r i s ») : on recolle les lettres
    if (/^\s*(\S\s){3,}\S\s*$/.test(str)) { str = str.replace(/\s+/g, ""); r.espace = true; }
    r.items.push({ x, str, w: it.width }); r.size = Math.max(r.size, size);
  }
  rows.sort((a, b) => b.y - a.y);
  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    if (r.espace) for (const it of r.items) if (/^\s*(\S\s)+\S\s*$/.test(it.str)) it.str = it.str.replace(/\s+/g, "");
    let txt = "", end = null, segX0 = r.items[0]?.x ?? 0, cells = [], cell = null;
    const finCell = () => { if (cell && cell.text.trim()) cells.push({ ...cell, text: cell.text.trim() }); cell = null; };
    for (const it of r.items) {
      const gap = end === null ? 0 : it.x - end;
      if (end !== null && gap > Math.max(r.size * 2.5, 18)) { finCell(); out.push({ text: txt, size: r.size, x0: segX0, x1: end, y: r.y, cells }); txt = ""; segX0 = it.x; cells = []; }
      else if (end !== null && gap > (r.espace ? Math.max(1.5, r.size * 0.4) : 1.5)) txt += " ";
      // cellules de tableau : coupure dès un écart nettement plus grand qu'une espace
      if (cell && gap > Math.max(r.size * 0.9, 5)) finCell();
      if (!cell) cell = { text: "", x0: it.x, x1: it.x };
      else if (gap > 1.5) cell.text += " ";
      cell.text += it.str; cell.x1 = it.x + (it.w || 0);
      txt += it.str; end = it.x + (it.w || 0);
    }
    finCell();
    if (txt.trim()) out.push({ text: txt, size: r.size, x0: segX0, x1: end, y: r.y, cells });
  }
  return out;
}
