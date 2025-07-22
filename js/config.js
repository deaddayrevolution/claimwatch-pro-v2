const CONFIG = {
  portal: { url: "https://choraquest.maps.arcgis.com" },
  layers: {
    notClosedClaims: { url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/MLRS_MINING_CLAIM_DATA_07192025_gdb/FeatureServer/0" },
    aois: { url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/ClaimWatch_AOIs/FeatureServer/0" }
  },
  blm: {
    notClosed: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0"
  }
};
