// Tariefparameters ENGIE Dynamic — particulieren Vlaams Gewest, netbeheerder Fluvius Limburg.
// Bron: ENGIE tariefkaart "Dynamic" voor contracten afgesloten in oktober 2026
// https://dtcmedia.s3.eu-central-1.amazonaws.com/tariffcard/1331159/nl-be-engie-dynamic-electricity-oktober-2026.pdf
// Werk deze waarden bij wanneer een nieuwe tariefkaart of nieuwe nettarieven verschijnen.
window.TARIFFS = {
  label: "ENGIE Dynamic · contracten oktober 2026 · Fluvius Limburg",
  vat: 0.06, // btw elektriciteit residentieel

  // Energieprijs afname (excl. btw, c€/kWh) = offtakeA + offtakeB × eSpot_15 (€/MWh)
  offtakeA: 0.7134,
  offtakeB: 0.1039,

  // Injectievergoeding (geen btw, c€/kWh) = injectA + injectB × eSpot_15
  injectA: -1.3135,
  injectB: 0.1,

  // Per kWh, incl. 6% btw (c€/kWh)
  greenWkk: 1.582, // kosten groene stroom & WKK-certificaten
  greenOption: 1.06, // optie 100% Belgische groene stroom (facultatief)
  networkKwh: 5.75257, // Fluvius Limburg totaal kWh-tarief (distributie + transmissie), digitale meter
  excise: 4.876, // federale bijzondere accijns

  // Vaste kosten, incl. btw
  fixedFeeYear: 100.7, // ENGIE vaste vergoeding €/jaar
  capacityKwYear: 51.9898, // Fluvius Limburg capaciteitstarief €/kW/jaar (min. 2,5 kW)
  capacityMinKw: 2.5,
  dataMgmtYear: 18.92, // tarief databeheer €/jaar
  energyFundMonth: 0, // Bijdrage Energiefonds (residentieel met domicilie)
  maxKwhNetwork: 34.72738, // maximumtarief capaciteit + kWh-tarief (c€/kWh)
};
