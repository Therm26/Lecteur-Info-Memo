// Tous les documents de ce dossier sont fictifs.
// Vérifie que les règles de lecture donnent toujours les valeurs attendues sur les documents de test (fictifs).
// Usage, à la racine du dépôt : npm install  puis  npm test
import fs from "fs";
import CFB from "cfb";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as X from "../src/extract.js";
import { lireMail } from "../src/mail.js";
const data = JSON.parse(fs.readFileSync(new URL("../listes.exemple.json", import.meta.url)));
const ici = (f) => new URL("../exemples/" + f, import.meta.url);
async function lirePdf(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(X.lignesPdfjs((await (await doc.getPage(i)).getTextContent()).items));
  return X.analyserDocument(pages, data);
}
async function lireFichierMail(f) {
  const info = lireMail(f, new Uint8Array(fs.readFileSync(ici(f))), CFB);
  const resMail = X.extraire(X.lignesMail(info), data);
  const pdfs = info.pj.filter((p) => /\.pdf$/i.test(p.nom));
  if (!pdfs.length) return X.fusionnerMail(null, resMail, info, data, { unSeulActif: true });
  const fiches = await lirePdf(pdfs[0].data.slice());
  return X.fusionnerMail(fiches[0], resMail, info, data, { unSeulActif: pdfs.length === 1 && fiches.length === 1 });
}
const CAS = [
  ["im_net.pdf", async () => (await lirePdf(new Uint8Array(fs.readFileSync(ici("im_net.pdf")))))[0],
    { adr: "220 rue de Vaugirard", cp: "75015", surf: 4210, occ: 0.92, loyer: 1248600, app: "Rive Droite Partners" }],
  ["im_rentroll.pdf", async () => (await lirePdf(new Uint8Array(fs.readFileSync(ici("im_rentroll.pdf")))))[0],
    { adr: "18 avenue de la République", cp: "92120", surf: 5120, typo: "Bureaux", loyer: 1544400, occ: 0.789, prix: 21500000, app: "Horizon Immobilier Conseil" }],
  ["mails/belvedere_horizon.eml", () => lireFichierMail("mails/belvedere_horizon.eml"),
    { date: "18/11/2026", adr: "18 avenue de la République", cp: "92120", surf: 5120, prix: 20900000, dl: "22/01/2027", mode: "Process restreint", app: "Horizon Immobilier Conseil", contact: "Claire DUPONT", loyer: 1544400 }],
  ["mails/marbeuf_transfere.eml", () => lireFichierMail("mails/marbeuf_transfere.eml"),
    { date: "24/11/2026", adr: "14 rue de Ponthieu", cp: "75008", surf: 212, prix: 4300000, mode: "Off market", app: "Rive Droite Partners", contact: "Marc LEROY" }],
];
let ok = 0, ko = 0;
for (const [nom, lire, attendu] of CAS) {
  const r = await lire();
  for (const [k, v] of Object.entries(attendu)) {
    const lu = r.champs[k]?.value ?? "";
    const bon = typeof v === "number" ? Math.abs(Number(lu) - v) <= Math.max(1, v * 0.01) : String(lu) === v;
    if (bon) ok++; else { ko++; console.log(`ÉCART ${nom} · ${k} : attendu ${JSON.stringify(v)}, lu ${JSON.stringify(lu)}`); }
  }
}
console.log(`${ok} valeurs justes, ${ko} écart(s).`);
process.exit(ko ? 1 : 0);
