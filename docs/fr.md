# KLF200 - io-homecontrol

Ceci est la documentation utilisateur de l'intégration. Gladys ré-héberge ce fichier et affiche un
lien **Documentation** permanent vers lui dans l'écran de configuration — c'est au moment de
configurer que l'utilisateur en a le plus besoin.

## Ce que vous obtenez

Chaque volet/fenêtre io-homecontrol® déjà appairé à votre passerelle Velux KLF200 (via l'appli
Velux ou l'interface d'appairage de la passerelle) apparaît automatiquement, avec deux
fonctionnalités pilotables :

- **Position** — un curseur 0–100 %.
- **État** — un bouton ouvert / stop / fermé.

Les deux sont interrogées toutes les 60 secondes : un mouvement fait en dehors de Gladys
(télécommande physique, appli Velux) est donc répercuté automatiquement en moins d'une minute.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez l'**adresse IP** et le **mot de passe** de la passerelle KLF200 (définis sur la
   passerelle elle-même). Optionnellement, collez son **empreinte TLS** pour épingler le
   certificat.
3. Enregistrez : l'intégration se connecte à la passerelle et les volets déjà connus apparaissent
   dans l'onglet **Découverte**, prêts à être ajoutés.

## Limitation connue

Le KLF200 n'accepte qu'**une seule connexion à la fois**. Si la passerelle vient d'être utilisée
par un autre client (l'appli Velux, une autre intégration…), une tentative de connexion peut être
brièvement refusée — l'intégration réessaie automatiquement toutes les 30 secondes, sans action
requise.

## Dépannage

L'intégration journalise chaque tentative de connexion, découverte et commande : consultez les
logs de l'intégration depuis l'interface Gladys (ou `docker logs` sur l'hôte).
