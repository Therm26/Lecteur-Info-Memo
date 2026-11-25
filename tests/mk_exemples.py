# Documents d'exemple fictifs : un teaser simple (im_net.pdf) et deux mails de broker
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from email.message import EmailMessage
import email.policy, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
c = canvas.Canvas("exemples/im_net.pdf", pagesize=A4); W, H = A4
c.setFont("Helvetica", 10); c.drawString(60, H - 70, "RIVE DROITE PARTNERS")
c.setFont("Helvetica", 22); c.drawString(60, H - 105, "LE CARRÉ VAUGIRARD")
c.setFont("Helvetica", 11)
for i, l in enumerate(["220 rue de Vaugirard, 75015 Paris", "Surface utile totale : 4 210 m²", "Multi-locataires, taux d'occupation de 92 %",
                       "Revenus annuels nets HT de 1 248 600 €", "CA actuel HT de 1 532 000 €", "Prix : nous consulter",
                       "Date limite de remise des offres : 18/12/2026"]):
    c.drawString(60, H - 140 - 26 * i, l)
c.showPage(); c.save()
m = EmailMessage(policy=email.policy.SMTP)
m["From"] = "Claire Dupont <claire.dupont@horizon-conseil.example>"
m["To"] = "equipe.invest@monentreprise.example"
m["Subject"] = "Le Belvédère – Montrouge – process restreint"
m["Date"] = "Wed, 18 Nov 2026 10:15:00 +0100"
m.set_content("""Bonjour,

Nous vous adressons le teaser du Belvédère, 18 avenue de la République à Montrouge, cédé dans le cadre d'un process restreint.

Prix demandé : 20 900 000 € hors droits.
Date limite de remise des offres : 22/01/2027.

Bien cordialement,
Claire Dupont
Horizon Immobilier Conseil""", charset="utf-8", cte="quoted-printable")
m.add_attachment(open("exemples/im_rentroll.pdf", "rb").read(), maintype="application", subtype="pdf", filename="Teaser Le Belvedere.pdf")
open("exemples/mails/belvedere_horizon.eml", "wb").write(m.as_bytes())
m2 = EmailMessage(policy=email.policy.SMTP)
m2["From"] = "Paul Durand <p.durand@monentreprise.example>"
m2["To"] = "equipe.invest@monentreprise.example"
m2["Subject"] = "TR: Opportunité off market – 14 rue de Ponthieu"
m2["Date"] = "Tue, 24 Nov 2026 17:05:00 +0100"
m2.set_content("""Peux-tu regarder ?

-----Message d'origine-----
De : Marc Leroy <marc.leroy@rivedroite.example>
Envoyé : mardi 24 novembre 2026 16:12
Objet : Opportunité off market – 14 rue de Ponthieu

Bonjour Paul,

Nous avons en exclusivité, en off market, un plateau de bureaux de 212 m² au 3e étage d'un immeuble en copropriété situé 14 rue de Ponthieu, 75008 Paris. Le plateau est vendu vide.

Prix : 4,3 M€ acte en main.
Merci de nous faire part de votre intérêt avant le 18/12/2026.

Marc
Rive Droite Partners""", charset="windows-1252", cte="8bit")
open("exemples/mails/marbeuf_transfere.eml", "wb").write(m2.as_bytes())
print("exemples régénérés")
