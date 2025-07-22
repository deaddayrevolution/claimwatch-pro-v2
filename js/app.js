/**
 * ClaimWatch Pro - Main Application
 * Monitors BLM claims, uses extractChanges, tracks AOIs, updates dashboard
 */

require([
  "esri/config", "esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer", "esri/layers/GraphicsLayer",
  "esri/widgets/Search", "esri/widgets/Sketch", "esri/geometry/geometryEngine"
], function(esriConfig, Map, MapView, FeatureLayer, GraphicsLayer, Search, Sketch, geometryEngine) {
  // 1. Portal config (for hosted layers)
  esriConfig.portalUrl = CONFIG.portal.url;

  // 2. Application state
  const app = {
    view: null,
    hostedClaimsLayer: null,
    aoiLayer: null,
    aois: [],
    sketchLayer: null,
    sketch: null,
    lastGen: null
  };

  // 3. Map and Layers
  async function initMap() {
    const map = new Map({ basemap: CONFIG.map.basemap });
    app.view = new MapView({
      container: "viewDiv",
      map: map,
      center: CONFIG.map.center,
      zoom: CONFIG.map.zoom
    });

    // Hosted claims layer
    app.hostedClaimsLayer = new FeatureLayer({
      url: CONFIG.layers.notClosedClaims.url,
      title: "My Hosted Mining Claims",
      outFields: ["*"]
    });
    map.add(app.hostedClaimsLayer);

    // AOI layer
    app.aoiLayer = new FeatureLayer({
      url: CONFIG.layers.aois.url,
      title: "AOIs",
      outFields: ["*"]
    });
    map.add(app.aoiLayer);

    // Graphics for AOI drawing
    app.sketchLayer = new GraphicsLayer();
    map.add(app.sketchLayer);

    await app.view.when();
  }

  // 4. AOI UI and drawing
  function setupAOI() {
    // Sketch widget for AOI
    app.sketch = new Sketch({
      layer: app.sketchLayer,
      view: app.view,
      creationMode: "single",
      availableCreateTools: ["polygon", "rectangle"]
    });
    document.getElementById("drawAOI").onclick = () => {
      app.sketch.create("polygon");
    };
    app.sketch.on("create", async (evt) => {
      if (evt.state === "complete") {
        const name = prompt("AOI name?");
        if (!name) return;
        // Save AOI to portal
        await app.aoiLayer.applyEdits({
          addFeatures: [{
            geometry: evt.graphic.geometry,
            attributes: {
              aoi_name: name,
              created_date: Date.now()
            }
          }]
        });
        alert("AOI saved.");
        app.sketchLayer.removeAll();
        loadAOIs();
      }
    });
  }

  async function loadAOIs() {
    // Load AOIs from hosted layer
    const result = await app.aoiLayer.queryFeatures({
      where: "1=1",
      outFields: ["*"],
      returnGeometry: true
    });
    app.aois = result.features;
    updateAOIList();
  }
  function updateAOIList() {
    const listDiv = document.getElementById("aoiList");
    if (!app.aois.length) {
      listDiv.innerHTML = "<div>No AOIs yet.</div>";
      return;
    }
    listDiv.innerHTML = app.aois.map(f => `<div class="aoi-item">${f.attributes.aoi_name}</div>`).join('');
  }

  // 5. Change Detection Logic
  async function extractChanges() {
    // Get last known serverGen or initialize from service
    let lastGen = localStorage.getItem(CONFIG.storage.lastGen);
    if (!lastGen) {
      const info = await fetch(CONFIG.blm.notClosed.replace(/\/0$/, "?f=pjson")).then(r => r.json());
      lastGen = info.changeTrackingInfo.layerServerGens[0].serverGen;
      localStorage.setItem(CONFIG.storage.lastGen, lastGen);
      alert("First sync: baseline set. No changes yet.");
      return;
    }
    // Prepare POST params for extractChanges
    const params = new URLSearchParams({
      f: "json",
      layers: "0",
      returnInserts: "true",
      returnUpdates: "true",
      returnDeletes: "true",
      returnIdsOnly: "true",
      layerServerGens: JSON.stringify([{ id: 0, serverGen: Number(lastGen) }])
    });
    // POST request
    const resp = await fetch(CONFIG.blm.notClosed.replace(/\/0$/, "/extractChanges"), {
      method: "POST", body: params
    });
    const data = await resp.json();
    // Handle async job pattern
    if (data.statusUrl) {
      let status;
      do {
        await new Promise(r => setTimeout(r, 2000));
        status = await fetch(data.statusUrl).then(r => r.json());
      } while (status.status !== "Completed");
      if (status.resultUrl) {
        data = await fetch(status.resultUrl).then(r => r.json());
      } else {
        throw new Error("extractChanges job did not complete");
      }
    }
    // Parse edits and update token
    const edits = data.edits?.find(e => e.id === 0) || {};
    const added = edits.objectIds?.adds || [];
    const modified = edits.objectIds?.updates || [];
    const deleted = edits.objectIds?.deletes || [];
    if (data.layerServerGens) {
      localStorage.setItem(CONFIG.storage.lastGen, data.layerServerGens[0].serverGen);
    }
    // Fetch attributes for new/modified claims
    const newClaims = await fetchFeaturesByIds(CONFIG.blm.notClosed, added);
    const modClaims = await fetchFeaturesByIds(CONFIG.blm.notClosed, modified);
    // For deletes, fetch last-known attrs from hosted or closed layer if possible
    updateDashboard(newClaims, modClaims, deleted);
  }

  // Utility: fetch full attributes for a set of objectIds
  async function fetchFeaturesByIds(url, ids) {
    if (!ids.length) return [];
    const features = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const params = new URLSearchParams({
        objectIds: slice.join(","),
        outFields: "*",
        returnGeometry: true,
        f: "json"
      });
      const resp = await fetch(url + "/query?" + params).then(r => r.json());
      if (resp.features) features.push(...resp.features);
    }
    return features;
  }

  // 6. Update dashboard/UI with results
  function updateDashboard(newClaims, modClaims, deletedIDs) {
    // AOI intersection
    let newInAOI = filterByAOI(newClaims, app.aois);
    let modInAOI = filterByAOI(modClaims, app.aois);
    // For deletes, you'd want to match by last-known geometry or by claim ID via Closed layer (optional, advanced)
    document.getElementById("newClaimsCount").textContent = newInAOI.length;
    document.getElementById("modifiedClaimsCount").textContent = modInAOI.length;
    document.getElementById("deletedClaimsCount").textContent = deletedIDs.length; // for full implementation, match to AOIs
  }
  // AOI intersection filter
  function filterByAOI(features, aois) {
    if (!aois.length) return [];
    return features.filter(f =>
      aois.some(aoi => geometryEngine.intersects(f.geometry, aoi.geometry))
    );
  }

  // 7. UI: buttons for change detection
  function setupUI() {
    document.getElementById("checkChanges").onclick = extractChanges;
    document.getElementById("drawAOI").onclick = () => app.sketch.create("polygon");
    loadAOIs();
  }

  // 8. Init sequence
  (async function startup() {
    await initMap();
    setupAOI();
    setupUI();
  })();
});
