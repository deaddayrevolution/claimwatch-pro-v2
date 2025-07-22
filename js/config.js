/**
 * ClaimWatch Pro - Configuration
 */
const CONFIG = {
  portal: {
    url: "https://choraquest.maps.arcgis.com"
  },

  // Hosted feature layers (your data)
  layers: {
    notClosedClaims: {
      url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/MLRS_MINING_CLAIM_DATA_07192025_gdb/FeatureServer/0"
    },
    closedClaims: {
      url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/MLRS_MINING_CLAIM_DATA_07192025_gdb/FeatureServer/1"
    },
    aois: {
      url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/ClaimWatch_AOIs/FeatureServer/0"
    },
    changeHistory: {
      url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/ClaimWatch_Change_History/FeatureServer/0"
    }
  },

  // BLM feature server (live public data)
  blm: {
    notClosed: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0",
    closed: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/FeatureServer/0"
  },

  // Map defaults
  map: {
    basemap: "topo-vector",
    center: [-115, 40],
    zoom: 6
  },

  // Storage key for extractChanges token
  storage: {
    lastGen: "claimwatch_last_servergen",
    lastCheck: "claimwatch_last_check"
  }
};
