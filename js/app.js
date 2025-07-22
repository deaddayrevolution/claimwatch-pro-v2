require([
  "esri/config", "esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer", "esri/layers/GraphicsLayer",
  "esri/widgets/Search", "esri/widgets/Sketch", "esri/geometry/geometryEngine"
], function(esriConfig, Map, MapView, FeatureLayer, GraphicsLayer, Search, Sketch, geometryEngine) {

  esriConfig.portalUrl = CONFIG.portal.url;

  const app = {
    view: null,
    claimsLayer: null,
    aoiLayer: null,
    aois: [],
    sketchLayer: null,
    selectedAOI: null,
    sketch: null
  };

  // --- 1. MAP AND AOI LAYERS ---
  async function initMap() {
    const map = new Map({ basemap: "topo-vector" });
    app.view = new MapView({ container: "viewDiv", map, center: [-115, 40], zoom: 6 });
    app.claimsLayer = new FeatureLayer({ url: CONFIG.layers.notClosedClaims.url, outFields: ["*"] });
    app.aoiLayer = new FeatureLayer({ url: CONFIG.layers.aois.url, outFields: ["*"] });
    app.sketchLayer = new GraphicsLayer();
    map.add(app.claimsLayer); map.add(app.aoiLayer); map.add(app.sketchLayer);

    // Show popups on click
    app.view.on("click", event => {
      app.view.hitTest(event).then(res => {
        const feat = res.results.find(r => r.graphic && r.graphic.layer === app.claimsLayer);
        if (feat) app.claimsLayer.popupTemplate = { title: "{CSE_NAME}", content: "ID: {CSE_NR}<br>State: {ADMIN_STATE}<br>County: {ADMIN_CNTY}" };
      });
    });

    await app.view.when();
  }

  // --- 2. AOI CREATION AND SELECTION ---
  function setupAOI() {
    app.sketch = new Sketch({ layer: app.sketchLayer, view: app.view, creationMode: "single", availableCreateTools: ["polygon", "rectangle"] });
    document.getElementById("drawAOI").onclick = () => { app.sketch.create("polygon"); };
    app.sketch.on("create", async evt => {
      if (evt.state === "complete") {
        const name = prompt("AOI name?");
        if (!name) return;
        await app.aoiLayer.applyEdits({ addFeatures: [{ geometry: evt.graphic.geometry, attributes: { aoi_name: name, created_date: Date.now() } }] });
        app.sketchLayer.removeAll();
        loadAOIs();
      }
    });
  }

  async function loadAOIs() {
    const result = await app.aoiLayer.queryFeatures({ where: "1=1", outFields: ["*"], returnGeometry: true });
    app.aois = result.features;
    const listDiv = document.getElementById("aoiList");
    listDiv.innerHTML = `<div class="aoi-item ${!app.selectedAOI ? "selected" : ""}">Entire Database</div>` +
      app.aois.map((f, i) => `<div class="aoi-item${app.selectedAOI === i ? " selected" : ""}" data-idx="${i}">${f.attributes.aoi_name}</div>`).join('');
    // AOI selection
    [...listDiv.querySelectorAll(".aoi-item")].forEach((el, i) => {
      el.onclick = () => {
        document.querySelectorAll(".aoi-item").forEach(e => e.classList.remove("selected"));
        el.classList.add("selected");
        app.selectedAOI = i === 0 ? null : i - 1;
        if (app.selectedAOI != null) app.view.goTo(app.aois[app.selectedAOI].geometry);
      };
    });
  }

  // --- 3. EXTRACT CHANGES BETWEEN SERVERGENS ---
  async function getServerGenForNow() {
    // Get current serverGen for BLM Not Closed
    const info = await fetch(CONFIG.blm.notClosed.replace(/\/0$/, "?f=pjson")).then(r => r.json());
    return info.changeTrackingInfo.layerServerGens[0].serverGen;
  }

  async function extractChangesFromServerGen(startGen) {
    // POST extractChanges since startGen
    const params = new URLSearchParams({
      f: "json", layers: "0", returnInserts: "true", returnUpdates: "true", returnDeletes: "true", returnIdsOnly: "true",
      layerServerGens: JSON.stringify([{ id: 0, serverGen: Number(startGen) }])
    });
    let data = await fetch(CONFIG.blm.notClosed.replace(/\/0$/, "/extractChanges"), { method: "POST", body: params }).then(r => r.json());
    // Async job handler
    if (data.statusUrl) {
      let status;
      do {
        await new Promise(r => setTimeout(r, 2000));
        status = await fetch(data.statusUrl).then(r => r.json());
      } while (status.status !== "Completed");
      if (status.resultUrl) data = await fetch(status.resultUrl).then(r => r.json());
    }
    const edits = data.edits?.find(e => e.id === 0) || {};
    return {
      added: edits.objectIds?.adds || [],
      updated: edits.objectIds?.updates || [],
      deleted: edits.objectIds?.deletes || [],
      newGen: data.layerServerGens ? data.layerServerGens[0].serverGen : startGen
    };
  }

  async function fetchFeaturesByIds(url, ids) {
    if (!ids.length) return [];
    let features = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const params = new URLSearchParams({ objectIds: slice.join(","), outFields: "*", returnGeometry: true, f: "json" });
      const resp = await fetch(url + "/query?" + params).then(r => r.json());
      if (resp.features) features.push(...resp.features);
    }
    return features;
  }

  // --- 4. UI EVENTS & SEARCH LOGIC ---
  document.getElementById("runExtract").onclick = async () => {
    // Step 1: Get start and end dates and serverGen for "since"
    const msg = document.getElementById("msg"); msg.textContent = "";
    const startDate = document.getElementById("startDate").value;
    if (!startDate) { msg.textContent = "Choose a Start Date."; return; }
    const endDate = document.getElementById("endDate").value;
    // ServerGen: ask user to enter the 'startGen' value for their chosen date, or offer to snapshot now.
    let startGen = prompt("Enter serverGen for Start Date (see BLM REST endpoint), or click OK to use current:");
    if (!startGen) startGen = await getServerGenForNow();

    msg.innerHTML = `<span class="info">Running extractChanges from serverGen: ${startGen} ...</span>`;
    // Step 2: Extract changes
    let changes;
    try { changes = await extractChangesFromServerGen(startGen); }
    catch (err) { msg.innerHTML = `<span class="error">extractChanges failed: ${err}</span>`; return; }
    if (!changes.added.length && !changes.updated.length && !changes.deleted.length) {
      msg.innerHTML = `<span class="info">No changes detected in this period.</span>`; return;
    }

    // Step 3: Fetch attributes for new/updated claims
    const newClaims = await fetchFeaturesByIds(CONFIG.blm.notClosed, changes.added);
    const updatedClaims = await fetchFeaturesByIds(CONFIG.blm.notClosed, changes.updated);

    // Step 4: AOI filter (if AOI selected)
    let aoiGeom = app.selectedAOI != null ? app.aois[app.selectedAOI].geometry : null;
    function inAOI(f) {
      if (!aoiGeom) return true;
      return geometryEngine.intersects(f.geometry, aoiGeom);
    }
    const newInAOI = newClaims.filter(inAOI);
    const updInAOI = updatedClaims.filter(inAOI);

    // Step 5: Build results table
    const results = [
      ...newInAOI.map(f => ({ type: "New", ...f.attributes })),
      ...updInAOI.map(f => ({ type: "Updated", ...f.attributes })),
      ...changes.deleted.map(id => ({ type: "Deleted", CSE_NR: id }))
    ];
    // Show summary
    document.getElementById("summary").innerHTML =
      `<b>Results (${results.length}):</b><br>
      <span class="success">${newInAOI.length} new</span>, 
      <span class="info">${updInAOI.length} updated</span>, 
      <span class="error">${changes.deleted.length} deleted</span> in ${aoiGeom ? "AOI" : "all data"}`;

    // Step 6: Render table
    const wrap = document.getElementById("tableWrap");
    if (!results.length) { wrap.innerHTML = "<div>No changes in this window.</div>"; return; }
    let html = `<table id="resultTable"><tr>
      <th>Type</th><th>Claim Name</th><th>Claim ID</th><th>State</th><th>County</th>
      <th>Status</th><th>Acres</th><th>Modified</th></tr>`;
    results.forEach(r => {
      html += `<tr>
        <td>${r.type}</td>
        <td>${r.CSE_NAME || ""}</td>
        <td>${r.CSE_NR || r.CSE_NR || ""}</td>
        <td>${r.ADMIN_STATE || ""}</td>
        <td>${r.ADMIN_CNTY || ""}</td>
        <td>${r.CSE_DISP || ""}</td>
        <td>${r.RCRD_ACRS || ""}</td>
        <td>${r.Modified || ""}</td>
      </tr>`;
    });
    html += "</table>";
    wrap.innerHTML = html;

    // Step 7: Graph (Chart.js)
    const ctx = document.getElementById('claimsChart').getContext('2d');
    const byType = { New: newInAOI.length, Updated: updInAOI.length, Deleted: changes.deleted.length };
    if (window._chart) window._chart.destroy();
    window._chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ["New", "Updated", "Deleted"],
        datasets: [{
          label: "# Claims",
          data: [byType.New, byType.Updated, byType.Deleted],
          backgroundColor: ["#28a745", "#2b7bba", "#c82333"]
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });

    // Step 8: Download CSV
    document.getElementById("downloadCSV").style.display = "inline-block";
    document.getElementById("downloadCSV").onclick = () => {
      let csv = "Type,Claim Name,Claim ID,State,County,Status,Acres,Modified\n";
      results.forEach(r => {
        csv += [r.type, r.CSE_NAME, r.CSE_NR, r.ADMIN_STATE, r.ADMIN_CNTY, r.CSE_DISP, r.RCRD_ACRS, r.Modified].join(",") + "\n";
      });
      const blob = new Blob([csv], {type: "text/csv"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "ClaimChanges.csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  };

  // --- INIT APP ---
  (async function () {
    await initMap();
    setupAOI();
    loadAOIs();
    // Set start/end default dates
   
