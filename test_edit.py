p="48H_FILM_DESK.html"

s=open(p,"r",encoding="utf-8-sig").read()

old='openPanel(\'${m}\')'
new='openDetached(\'${m}\')'

if old not in s:
    print("ERREUR : bouton ↗ introuvable")
elif new in s:
    print("ERREUR : bouton déjà modifié")
else:
    s=s.replace(old,new,1)
    open(p,"w",encoding="utf-8").write(s)
    print("OK — bouton détachable configuré")