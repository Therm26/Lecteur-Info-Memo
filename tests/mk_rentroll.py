# Document de test fictif (noms, adresses et chiffres inventés) : état locatif multi-locataires, en-tête sur 2 lignes, ligne vacante et total
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
c = canvas.Canvas("exemples/im_rentroll.pdf", pagesize=landscape(A4))
W, H = landscape(A4)
c.setFont("Helvetica-Bold", 26); c.drawString(40, H-60, "LE BELVÉDÈRE")
c.setFont("Helvetica", 11)
c.drawString(40, H-85, "Immeuble de bureaux de 5 120 m² situé 18 avenue de la République, 92120 Montrouge. Mandat exclusif Horizon Immobilier Conseil.")
c.drawString(40, H-100, "Immeuble construit en 1992, rénové en 2018, R+7 sur 2 niveaux de sous-sol, 64 places de parking. Métro ligne 4.")
c.setFont("Helvetica-Bold", 16); c.drawString(40, H-140, "État locatif au 1er octobre 2026")
cols = [40, 210, 300, 380, 470, 560, 650, 740]
h1 = ["Locataire", "Étage", "Surface", "Date d'effet", "Prochaine", "Fin du", "Loyer annuel", "Loyer"]
h2 = ["", "", "(m² SUB)", "du bail", "échéance", "bail", "HT HC (€)", "€/m²"]
c.setFont("Helvetica-Bold", 9)
for x, a, b in zip(cols, h1, h2): c.drawString(x, H-175, a); c.drawString(x, H-186, b)
rows = [
 ["ALTAÏR CONSEIL", "R+1 à R+3", "2 150", "01/07/2021", "30/06/2027", "30/06/2030", "828 000", "385"],
 ["Cabinet Martin", "R+4", "720", "15/03/2023", "14/03/2029", "14/03/2032", "266 400", "370"],
 ["Banque Lumière", "RDC", "480", "01/01/2020", "31/12/2025", "31/12/2028", "201 600", "420"],
 ["Atelier Nova", "R+5", "690", "01/10/2024", "30/09/2030", "30/09/2033", "248 400", "360"],
 ["Vacant", "R+6 et R+7", "1 080", "", "", "", "", ""],
 ["TOTAL", "", "5 120", "", "", "", "1 544 400", ""],
]
c.setFont("Helvetica", 9)
y = H-210
for r in rows:
    if r[0] == "TOTAL": c.setFont("Helvetica-Bold", 9)
    for x, v in zip(cols, r): c.drawString(x, y, v)
    y -= 18
c.setFont("Helvetica", 8); c.drawString(40, y-10, "Source : bailleur. Loyers indexés au 1er octobre 2026.")
c.setFont("Helvetica", 11); c.drawString(40, y-40, "Prix de cession demandé : 21 500 000 € hors droits. Remise des offres le 15/01/2027.")
c.showPage(); c.save()
