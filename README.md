# Conqueror

Snelle real-time strategiegame in de browser op een hexkaart van de wereld. Kies een historisch volk, verover vrije stammen en rivalen, bouw fabrieken en groei uit tot een wereldrijk.

## Spelen

Open `index.html` in een browser. Er is geen build-stap of server nodig.

- **Klik** op een eigen vakje om het te selecteren, en klik dan op een vijandig of vrij vakje om aan te vallen (je leger loopt via je eigen gebied en over zeestraten).
- **Rechtsklik** op een eigen vakje om er troepen naartoe te verplaatsen.
- **Slepen** verschuift de kaart, **scrollen** zoomt. `C` springt naar je hoofdstad, `spatie` pauzeert, `1`/`2`/`3` zet de snelheid.
- `Q`/`W`/`E` rekruteert 5 infanterie, boogschutters of cavalerie op het geselecteerde vakje (met shift: 1), `F` bouwt een fabriek.

Je wint met 50% van alle land. Je verliest als je laatste gebied valt of een rivaal als eerste aan 50% komt.

## Systemen

- **Goud** komt per gebied binnen, en vooral uit **fabrieken**. Je betaalt er troepen, gebouwen en technologie mee. Elke soldaat kost onderhoud.
- **Bestuurspunten (BP)** komen per gebied binnen, plus extra uit tempels. Je onderzoekt er regeringsvormen mee (Despotie, Monarchie, Republiek, Keizerrijk, Democratie, …). Elke vorm geeft eigen bonussen.
- **Tech tree**: 6 tijdperken en per eenheidstype 6 tiers (infanterie, boogschutters, cavalerie), met als eindpunt *Moderne Natie*. Iedereen, ook de AI, doorloopt dezelfde boom.
- **Gevecht**: infanterie verslaat cavalerie, cavalerie verslaat boogschutters, en boogschutters verslaan infanterie. Forten, je hoofdstad en de regeringsvorm geven verdedigingsbonussen.
- Elk land start met minstens 6 kerngebieden. Daar verschijnen automatisch nieuwe troepen (lichting).

## Structuur

| Bestand | Inhoud |
|---|---|
| `js/data.js` | Landen, eenheden, tech tree, regeringsvormen, balans-constanten |
| `js/world.js` | Hexgrid, buren, zeestraten, startgebieden |
| `js/game.js` | Simulatie: economie, onderzoek, legers, gevechten |
| `js/ai.js` | Computertegenstanders |
| `js/render.js` | Canvas-kaart met pan/zoom |
| `js/ui.js` | HUD, panelen, invoer |
| `js/mapdata.js` | Gegenereerde landmaskers (`tools/build_map.py`, op basis van Natural Earth via world-atlas) |
