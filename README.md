# Conqueror

Snelle real-time strategiegame in de browser op een hexkaart van de wereld. Kies een historisch volk, verover vrije stammen en rivalen, bouw fabrieken, vloten en luchtmachten, en groei uit tot een wereldrijk.

## Spelen

**Alleen spelen:** open `index.html` in een browser. Er is geen build-stap nodig.

**Multiplayer:** start de server in de spelmap (alleen Python 3, geen extra pakketten nodig):

```
python3 server.py          # of: python3 server.py 8080
```

Open daarna `http://localhost:8000`, kies **Multiplayer** en klik op **Nieuwe kamer**. Je krijgt een kamercode van 4 letters. Medespelers openen het adres dat de server toont (bijvoorbeeld `http://192.168.1.20:8000`), vullen de code in en kiezen elk een eigen land. De host start het spel; landen die niemand kiest, worden door de computer gespeeld. Om via internet te spelen moet de host de poort openzetten of een tunnel gebruiken, bijvoorbeeld `cloudflared` of `ngrok`.

De host draait de simulatie en de andere spelers sturen alleen hun bevelen. Wie het spel verlaat, wordt door de computer vervangen. Als de host vertrekt, eindigt het spel.

## Besturing

- **Klik** op een eigen vakje om het te selecteren, en klik dan op een vijandig of vrij vakje om aan te vallen. **Rechtsklik** op een eigen vakje verplaatst troepen.
- **Schepen en vliegtuigen:** klik erop om ze te selecteren. Klik op zee of land om te varen of vliegen, en op een vijandelijk vakje of eenheid om aan te vallen. Een rechtsklik op een eigen vakje zet troepen af. `H` stuurt een eenheid terug naar de basis.
- **Slepen** verschuift de kaart, **scrollen** zoomt. `C` springt naar je hoofdstad, `spatie` pauzeert, `1`/`2`/`3` zet de snelheid (in multiplayer kan alleen de host dat).
- `Q`/`W`/`E` rekruteert 5 infanterie, boogschutters of cavalerie (met shift: 1), `F` bouwt een fabriek.

Je wint met 50% van alle land. Je verliest als je laatste gebied valt of een rivaal als eerste aan 50% komt.

## Systemen

- **Goud** komt per gebied binnen, en vooral uit **fabrieken**. Je betaalt er troepen, gebouwen, schepen, vliegtuigen en technologie mee. Elke soldaat, elk schip en elk vliegtuig kost onderhoud.
- **Bestuurspunten (BP)** komen per gebied binnen en uit tempels. Je onderzoekt er regeringsvormen mee (Despotie, Monarchie, Republiek, Keizerrijk, Democratie, …), elk met eigen bonussen.
- **Tech tree:** 6 tijdperken (Oudheid tot Moderne Tijd). Per eenheidstype zijn er 6 tiers, bijvoorbeeld van Strijdwagens tot Tanks, met als eindpunt *Moderne Natie*. Iedereen, ook de AI, doorloopt dezelfde boom.
- **Gevecht:** infanterie verslaat cavalerie, cavalerie verslaat boogschutters, en boogschutters verslaan infanterie. Forten, je hoofdstad en de regeringsvorm geven verdedigingsbonussen.

### Marine en luchtmacht

| Tech | Ontgrendelt |
|---|---|
| Scheepsbouw (tijdperk 2) | **Haven** (kust) en **transportschip**: vervoert 40 troepen. Je laadt aan een eigen kust en landt op een vijandelijke kust (amfibische aanval −20%). |
| Oorlogsvloot (tijdperk 3) | **Torpedobootjager** (anti-schip en luchtafweer, bereik 2) en **kustbatterij** (beschiet vijandelijke schepen) |
| Linieschepen (tijdperk 4) | **Slagschip**: beschiet troepen in aangrenzende kustgebieden |
| Luchtvaart (tijdperk 5) | **Vliegveld**, **transporthelikopter** (15 troepen, vliegt over land en zee) en **luchtafweer** |
| Luchtmacht (tijdperk 5) | **Bommenwerper**: bombardeert troepen of schepen en keert dan terug om te herladen |

Schepen en vliegtuigen schieten automatisch op vijanden binnen bereik. Hun naam en kracht groeien mee met je tijdperk, bijvoorbeeld van Oorlogsgalei via Fregat tot Torpedobootjager.

## Structuur

| Bestand | Inhoud |
|---|---|
| `js/data.js` | Landen, eenheden, tech tree, regeringsvormen, schepen/vliegtuigen, balans-constanten |
| `js/world.js` | Hexgrid, land- en zeevakken, zeestraten, startgebieden |
| `js/game.js` | Simulatie: economie, onderzoek, legers, schepen, vliegtuigen, gevechten, multiplayer-snapshots |
| `js/ai.js` | Computertegenstanders (ook voor vloot en luchtmacht) |
| `js/net.js` | Multiplayer-client: lobby, commando's, snapshots |
| `js/render.js` | Canvas-kaart met pan/zoom |
| `js/ui.js` | HUD, panelen, lobby, invoer |
| `server.py` | Webserver en WebSocket-relay voor multiplayer (alleen standaardbibliotheek) |
| `js/mapdata.js` | Gegenereerde landmaskers (`tools/build_map.py`, op basis van Natural Earth via world-atlas) |
