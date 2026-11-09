# energie-tarieven-dashboard

Live dashboard met de **dynamische all-in stroomprijs (c€/kWh, incl. btw)** voor klanten met een
**ENGIE Dynamic**-contract in **Limburg (Fluvius Limburg)**: historiek, gekende day-ahead-prijzen en een
indicatieve verwachting.

**Live:** https://peteriron.github.io/energie-tarieven-dashboard/

## Hoe het werkt

- ENGIE Dynamic volgt per kwartier de **EPEX SPOT Day-Ahead**-prijs voor België (eSpot_15), dezelfde
  publieke prijs die Home Assistant via de Nord Pool- of ENTSO-E-integratie gebruikt.
- Een GitHub Action haalt elk half uur de BE-kwartierprijzen op via de publieke
  [Energy-Charts API](https://api.energy-charts.info) (geen API-sleutel nodig) en publiceert de site op GitHub Pages.
- De browser rekent de all-in prijs uit met de parameters in [`tariffs.js`](tariffs.js):

```
all-in (c€/kWh) = (0,7134 + 0,1039 × eSpot_15) × 1,06      energie ENGIE incl. 6% btw
                + 5,75257                                  netkosten Fluvius Limburg (kWh-tarief)
                + 4,876                                    federale bijzondere accijns
                + 1,582                                    groene stroom & WKK
injectie (c€/kWh) = −1,3135 + 0,1000 × eSpot_15            geen btw
```

Vaste kosten (vaste vergoeding, capaciteitstarief, databeheer) worden apart getoond.
Bezoekers kunnen de formule van hun eigen contractmaand instellen in het dashboard.

Bron tarieven: ENGIE-tariefkaart Dynamic, contracten oktober 2026, Vlaams Gewest.
Werk `tariffs.js` bij bij een nieuwe tariefkaart of nieuwe nettarieven (jaarlijks in januari).

## Lokaal draaien

```sh
node scripts/fetch-prices.mjs   # schrijft data/prices.json
python3 -m http.server 8000     # open http://localhost:8000
```

Niet-officieel; geen product van ENGIE of Fluvius.
