/**
 * ClaimWatch Pro - Complete Application with BLM Integration
 * Implements MapServer/FeatureServer hybrid approach for optimal performance
 */

// Check if we need to authenticate with portal
const portalUrl = CONFIG.portal.url;

require([
    "esri/config",
    "esri/identity/IdentityManager",
    "esri/portal/Portal",
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/layers/MapImageLayer",
    "esri/layers/GraphicsLayer",
    "esri/widgets/Search",
    "esri/widgets/LayerList",
    "esri/widgets/Legend",
    "esri/widgets/Sketch",
    "esri/widgets/Expand",
    "esri/Graphic",
    "esri/geometry/Extent",
    "esri/geometry/geometryEngine",
    "esri/core/reactiveUtils",
    "esri/geometry/support/webMercatorUtils",
    "esri/rest/support/Query",
    "esri/layers/support/Sublayer"
], function(
    esriConfig,
    IdentityManager,
    Portal,
    Map,
    MapView,
    FeatureLayer,
    MapImageLayer,
    GraphicsLayer,
    Search,
    LayerList,
    Legend,
    Sketch,
    Expand,
    Graphic,
    Extent,
    geometryEngine,
    reactiveUtils,
    webMercatorUtils,
    Query,
    Sublayer
) {
    // Configure portal URL and authentication
    esriConfig.portalUrl = CONFIG.portal.url;
    
    // Set up portal authentication
    const portal = new Portal({
        url: CONFIG.portal.url
    });
    
    // Load portal and handle authentication
portal.load().then(function() {
    console.log("Portal loaded:", portal.title || "Choraquest Portal");
    console.log("Portal user:", portal.user);
    
    // Check if we can access portal data (which means we're authenticated)
    if (portal.user || portal.credential) {
        // We're authenticated, update display
        const username = portal.user ? portal.user.username : "Authenticated User";
        document.getElementById("userInfo").textContent = username;
    } else {
        // Try to get current user
        IdentityManager.findCredential(portal.url).then(function(credential) {
            if (credential) {
                document.getElementById("userInfo").textContent = credential.userId || "Signed In";
            } else {
                document.getElementById("userInfo").innerHTML = 
                    '<button onclick="signIn()" style="background:#fff;color:#2b7bba;border:1px solid #2b7bba;padding:5px 10px;border-radius:3px;cursor:pointer;">Sign In</button>';
            }
        });
    }
}).catch(function(error) {
    console.error("Portal load error:", error);
    document.getElementById("userInfo").textContent = "Login required";
});
    
    // Application state management
    const app = {
        // Map and view
        view: null,
        
        // Hosted layers (your complete dataset)
        hostedClaimsLayer: null,
        hostedClosedClaimsLayer: null,
        aoiFeatureLayer: null,
        changeHistoryLayer: null,
        
        // BLM layers (live data)
        blmActiveMapLayer: null,
        blmClosedMapLayer: null,
        
        // Graphics layers
        aoiDrawingLayer: null,
        sketch: null,
        
        // Application data
        aois: [],
        currentFilter: "all",
        lastExtractTime: null,
        autoCheckInterval: null,
        serviceStatusInterval: null,
        
        // Statistics
        statistics: {
            total: 0,
            inView: 0,
            recent: 0
        },
        
        // Change detection state
        changeDetection: {
            isRunning: false,
            lastResults: null,
            batchProgress: 0
        },
        
        // Service status tracking
        serviceStatus: {
            blmActive: false,
            blmClosed: false,
            hosted: false
        }
    };
    
    // Initialize the application
    async function init() {
        try {
            showMessage("Initializing ClaimWatch Pro...", "info");
            
            setupMap();
            await setupLayers();
            setupWidgets();
            setupEventHandlers();
            await loadAOIsFromPortal();
            await updateStatistics();
            await checkServiceStatus();
            
            // Set up intervals
            setInterval(updateStatistics, CONFIG.refresh.statistics);
            setInterval(checkServiceStatus, CONFIG.refresh.serviceStatus);
            
            // Initialize date picker
            initializeDatePicker();
            
            showMessage("ClaimWatch Pro loaded successfully", "success");
            
        } catch (error) {
            console.error("Initialization error:", error);
            showMessage("Error loading application: " + error.message, "error");
        }
    }
    
    // Set up the map and view
    function setupMap() {
        const map = new Map({
            basemap: CONFIG.map.basemap
        });
        
        app.view = new MapView({
            container: "viewDiv",
            map: map,
            center: CONFIG.map.center,
            zoom: CONFIG.map.zoom,
            extent: new Extent(CONFIG.map.extent)
        });
        
        // Update statistics when view changes
        reactiveUtils.when(
            () => app.view.stationary,
            () => {
                updateStatisticsInView();
            }
        );
    }
    
    // Set up all layers with proper ordering and configuration
    async function setupLayers() {
        try {
            // 1. BLM Map Layers (bottom - for complete visualization)
            await setupBLMMapLayers();
            
            // 2. Hosted Feature Layers (middle - your working data)
            await setupHostedLayers();
            
            // 3. AOI and Graphics Layers (top - interactive)
            await setupInteractiveLayers();
            
            console.log("All layers loaded successfully");
            
        } catch (error) {
            console.error("Error setting up layers:", error);
            throw error;
        }
    }
    
    // Setup BLM MapImageLayers for fast visualization of all claims
    async function setupBLMMapLayers() {
        // BLM Closed Claims MapServer
        app.blmClosedMapLayer = new MapImageLayer({
            url: CONFIG.blmServices.closedMap,
            title: "BLM Closed Claims (Live - All Data)",
            visible: false,
            opacity: 0.4,
            sublayers: [{
                id: 0,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.blmClosed
                }
            }]
        });
        
        // BLM Active Claims MapServer
        app.blmActiveMapLayer = new MapImageLayer({
            url: CONFIG.blmServices.notClosedMap,
            title: "BLM Active Claims (Live - All Data)", 
            visible: false,
            opacity: 0.6,
            sublayers: [{
                id: 0,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.blmActive
                }
            }]
        });
        
        // Add to map (bottom layers)
        app.view.map.add(app.blmClosedMapLayer);
        app.view.map.add(app.blmActiveMapLayer);
        
        console.log("BLM Map layers added");
    }
    
    // Setup your hosted feature layers (complete datasets)
    async function setupHostedLayers() {
        // Your hosted active claims layer
        app.hostedClaimsLayer = new FeatureLayer({
            url: CONFIG.layers.notClosedClaims.url,
            title: CONFIG.layers.notClosedClaims.title,
            outFields: ["*"],
            popupTemplate: CONFIG.popupTemplates.claims,
            renderer: {
                type: "simple",
                symbol: CONFIG.symbols.hostedDefault
            },
            opacity: 0.8
        });
        
        // Your hosted closed claims layer
        app.hostedClosedClaimsLayer = new FeatureLayer({
            url: CONFIG.layers.closedClaims.url,
            title: CONFIG.layers.closedClaims.title,
            outFields: ["*"],
            visible: false,
            popupTemplate: CONFIG.popupTemplates.claims,
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [128, 128, 128, 0.5],
                    outline: {
                        color: [64, 64, 64, 1],
                        width: 1
                    }
                }
            },
            opacity: 0.6
        });
        
        // AOI feature layer
        app.aoiFeatureLayer = new FeatureLayer({
            url: CONFIG.layers.aois.url,
            title: CONFIG.layers.aois.title,
            outFields: ["*"],
            renderer: {
                type: "simple",
                symbol: CONFIG.symbols.aoi
            },
            popupTemplate: CONFIG.popupTemplates.aoi
        });
        
        // Change history layer
        app.changeHistoryLayer = new FeatureLayer({
            url: CONFIG.layers.changeHistory.url,
            title: CONFIG.layers.changeHistory.title,
            outFields: ["*"],
            visible: false,
            renderer: {
                type: "unique-value",
                field: "change_type",
                uniqueValueInfos: [
                    {
                        value: "new",
                        symbol: CONFIG.symbols.changeNew
                    },
                    {
                        value: "modified", 
                        symbol: CONFIG.symbols.changeModified
                    },
                    {
                        value: "deleted",
                        symbol: CONFIG.symbols.changeDeleted
                    }
                ]
            },
            popupTemplate: CONFIG.popupTemplates.changeHistory
        });
        
        // Add to map
        app.view.map.add(app.hostedClosedClaimsLayer);
        app.view.map.add(app.hostedClaimsLayer);
        app.view.map.add(app.aoiFeatureLayer);
        app.view.map.add(app.changeHistoryLayer);
        
        // Wait for layers to load
        await Promise.all([
            app.hostedClaimsLayer.load(),
            app.hostedClosedClaimsLayer.load(),
            app.aoiFeatureLayer.load(),
            app.changeHistoryLayer.load()
        ]);
        
        console.log("Hosted layers loaded");
    }
    
    // Setup interactive layers (AOI drawing, etc.)
    async function setupInteractiveLayers() {
        // AOI drawing layer
        app.aoiDrawingLayer = new GraphicsLayer({
            title: "AOI Drawing",
            listMode: "hide"
        });
        
        app.view.map.add(app.aoiDrawingLayer);
    }
    
    // Set up widgets (search, layer list, etc.)
    function setupWidgets() {
        // Search widget
        const search = new Search({
            view: app.view,
            includeDefaultSources: false,
            sources: [{
                layer: app.hostedClaimsLayer,
                searchFields: ["CSE_NR", "CSE_NAME"],
                displayField: "CSE_NAME",
                exactMatch: false,
                placeholder: "Search by claim ID or name",
                name: "Mining Claims"
            }]
        });
        
        app.view.ui.add(search, "top-left");
        
        // Layer list
        const layerList = new LayerList({
            view: app.view,
            listItemCreatedFunction: function(event) {
                const item = event.item;
                if (item.layer.type === "feature" || item.layer.type === "map-image") {
                    item.panel = {
                        content: "legend",
                        open: false
                    };
                }
            }
        });
        
        const layerListExpand = new Expand({
            view: app.view,
            content: layerList,
            expandIconClass: "esri-icon-layers"
        });
        
        app.view.ui.add(layerListExpand, "top-left");
        
        // Legend
        const legend = new Legend({
            view: app.view
        });
        
        const legendExpand = new Expand({
            view: app.view,
            content: legend,
            expandIconClass: "esri-icon-legend"
        });
        
        app.view.ui.add(legendExpand, "top-left");
        
        // Sketch widget for AOI drawing
        app.sketch = new Sketch({
            layer: app.aoiDrawingLayer,
            view: app.view,
            creationMode: "single",
            availableCreateTools: ["polygon", "rectangle"],
            updateOnGraphicClick: false,
            container: document.createElement("div")
        });
        
        // Add sketch widget to tools div
        const toolsDiv = document.getElementById("tools-widget");
        if (toolsDiv) {
            toolsDiv.appendChild(app.sketch.container);
            app.sketch.visible = false;
        }
    }
    
    // Set up all event handlers
    function setupEventHandlers() {
        // Layer toggles
        document.getElementById("hostedLayerToggle").addEventListener("change", (e) => {
            app.hostedClaimsLayer.visible = e.target.checked;
        });
        
        document.getElementById("blmActiveToggle").addEventListener("change", (e) => {
            app.blmActiveMapLayer.visible = e.target.checked;
        });
        
        document.getElementById("blmClosedToggle").addEventListener("change", (e) => {
            app.blmClosedMapLayer.visible = e.target.checked;
        });
        
        document.getElementById("changeHistoryToggle").addEventListener("change", (e) => {
            app.changeHistoryLayer.visible = e.target.checked;
        });
        
        // Opacity sliders
        document.getElementById("hostedOpacity").addEventListener("input", (e) => {
            app.hostedClaimsLayer.opacity = e.target.value / 100;
        });
        
        document.getElementById("blmActiveOpacity").addEventListener("input", (e) => {
            app.blmActiveMapLayer.opacity = e.target.value / 100;
        });
        
        document.getElementById("blmClosedOpacity").addEventListener("input", (e) => {
            app.blmClosedMapLayer.opacity = e.target.value / 100;
        });
        
        // Filter buttons
        document.querySelectorAll(".filter-button").forEach(button => {
            button.addEventListener("click", (e) => {
                applyFilter(e.target.dataset.filter);
                
                // Update active state
                document.querySelectorAll(".filter-button").forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");
            });
        });
        
        // AOI tools
        document.getElementById("drawAOI").addEventListener("click", () => {
            app.sketch.visible = true;
            app.sketch.create("polygon");
            showMessage("Click on the map to draw your area of interest", "info");
        });
        
        document.getElementById("clearAOI").addEventListener("click", () => {
            app.sketch.cancel();
            app.sketch.visible = false;
            app.aoiDrawingLayer.removeAll();
        });
        
        // Sketch events
        app.sketch.on("create", (event) => {
            if (event.state === "complete") {
                createAOI(event.graphic);
                app.sketch.visible = false;
            }
        });
        
        // Change detection
        document.getElementById("checkChanges").addEventListener("click", checkForChanges);
        document.getElementById("autoCheckFrequency").addEventListener("change", (e) => {
            setupAutoCheck(e.target.value);
        });
        document.getElementById("exportChanges").addEventListener("click", exportChangeReport);
        
        // AOI Analysis
        document.getElementById("analyzeAOIs").addEventListener("click", analyzeAllAOIs);
        document.getElementById("exportAOIReport").addEventListener("click", exportAOIReport);
    }
    
    // Apply filter to hosted claims layer
    function applyFilter(filterType) {
        app.currentFilter = filterType;
        let where = "1=1";
        let symbol = CONFIG.symbols.hostedDefault;
        
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        switch(filterType) {
            case "recent":
                where = `Modified >= '${weekAgo.toISOString().split('T')[0]}'`;
                symbol = CONFIG.symbols.hostedRecent;
                break;
            case "risk":
                where = `Modified < '${CONFIG.riskCriteria.paymentRiskDate}' AND CSE_DISP = 'Active'`;
                symbol = CONFIG.symbols.hostedRisk;
                break;
        }
        
        app.hostedClaimsLayer.definitionExpression = where;
        app.hostedClaimsLayer.renderer = {
            type: "simple",
            symbol: symbol
        };
        
        updateStatistics();
    }
    
    // Main change detection function with Extract Changes
    async function checkForChanges() {
        if (app.changeDetection.isRunning) {
            showMessage("Change detection already in progress...", "info");
            return;
        }
        
        const button = document.getElementById("checkChanges");
        const indicator = document.getElementById("changeCheckIndicator");
        
        try {
            app.changeDetection.isRunning = true;
            button.disabled = true;
            button.textContent = "Checking...";
            indicator.className = "sync-indicator checking";
            
            showMessage("Checking BLM for changes...", "info");
            
            // Check service availability first
            const serviceCheck = await checkBLMServiceStatus();
            if (!serviceCheck.available) {
                throw new Error(`BLM service unavailable: ${serviceCheck.error}`);
            }
            
            // Get date range for checking
            const sinceDate = getSinceDate();
            
            // Use Extract Changes if available, otherwise fall back to query comparison
            let changes;
            if (await supportsExtractChanges()) {
                changes = await extractChangesFromBLM(sinceDate);
            } else {
                changes = await detectChangesByComparison(sinceDate);
            }
            
            // Process and display results
            await processChangeResults(changes);
            
            // Update last check time
            app.lastExtractTime = new Date();
            updateLastCheckDisplay();
            localStorage.setItem(CONFIG.storage.lastCheck, app.lastExtractTime.toISOString());
            
            const totalChanges = changes.new.length + changes.modified.length + changes.deleted.length;
            showMessage(`Found ${totalChanges} changes since ${sinceDate.toLocaleDateString()}`, 
                       totalChanges > 0 ? "success" : "info");
                       
        } catch (error) {
            console.error("Change detection error:", error);
            indicator.className = "sync-indicator offline";
            
            if (error.message.includes("unavailable") || error.message.includes("offline")) {
                showMessage("BLM service is currently unavailable", "error");
            } else {
                showMessage("Error checking for changes: " + error.message, "error");
            }
        } finally {
            app.changeDetection.isRunning = false;
            button.disabled = false;
            button.textContent = "Check for Changes Now";
            indicator.className = "sync-indicator offline";
        }
    }
    
    // Check if BLM service supports Extract Changes
    async function supportsExtractChanges() {
        try {
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "?f=json");
            const serviceInfo = await response.json();
            return serviceInfo.hasStaticData === false && serviceInfo.supportsExtractChanges === true;
        } catch (error) {
            console.warn("Could not determine Extract Changes support:", error);
            return false;
        }
    }
    
    // Extract changes using ArcGIS REST Extract Changes endpoint
    async function extractChangesFromBLM(sinceDate) {
        console.log("Using Extract Changes method");
        
        // Get our last serverGen if available
        const lastServerGen = localStorage.getItem('claimwatch_last_servergen') || '0';
        
        const extractQuery = {
            serverGen: lastServerGen,
            returnChanges: true,
            f: "json"
        };
        
        const response = await fetch(
            CONFIG.blmServices.notClosedFeatures + "/extractChanges?" + 
            new URLSearchParams(extractQuery)
        );
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(`Extract Changes error: ${data.error.message}`);
        }
        
        // Store new serverGen
        if (data.serverGen) {
            localStorage.setItem('claimwatch_last_servergen', data.serverGen.toString());
        }
        
        return {
            new: data.addedFeatures || [],
            modified: data.updatedFeatures || [],
            deleted: data.deletedFeatureIds || [],
            serverGen: data.serverGen
        };
    }
    
    // Fallback method: detect changes by comparing datasets
    async function detectChangesByComparison(sinceDate) {
        console.log("Using comparison method for change detection");
        
        // Query BLM for recently modified features
        const blmQuery = new Query({
            where: `Modified >= '${sinceDate.toISOString().split('T')[0]}'`,
            outFields: ["*"],
            returnGeometry: true,
            resultRecordCount: CONFIG.blmServices.serviceInfo.maxRecordCount
        });
        
        // Get BLM data in batches
        const blmFeatures = await queryBLMInBatches(CONFIG.blmServices.notClosedFeatures, blmQuery);
        
        // Get our corresponding data
        const ourQuery = app.hostedClaimsLayer.createQuery();
        ourQuery.where = "1=1";
        ourQuery.outFields = ["CSE_NR", "Modified", "OBJECTID"];
        ourQuery.returnGeometry = false;
        const ourResults = await app.hostedClaimsLayer.queryFeatures(ourQuery);
        
        // Compare and categorize changes
        return compareAndCategorizeChanges(blmFeatures, ourResults.features);
    }
    
    // Query BLM service in batches to handle large datasets
    async function queryBLMInBatches(serviceUrl, query, allFeatures = []) {
        try {
            const response = await fetch(serviceUrl + "/query?" + new URLSearchParams({
                where: query.where,
                outFields: query.outFields.join(","),
                returnGeometry: query.returnGeometry,
                f: "json",
                resultRecordCount: query.resultRecordCount,
                resultOffset: allFeatures.length
            }));
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(`BLM query error: ${data.error.message}`);
            }
            
            if (data.features && data.features.length > 0) {
                allFeatures = allFeatures.concat(data.features);
                
                // If we got the max count, there might be more
                if (data.features.length === query.resultRecordCount) {
                    return await queryBLMInBatches(serviceUrl, query, allFeatures);
                }
            }
            
            return allFeatures;
            
        } catch (error) {
            console.error("Error querying BLM in batches:", error);
            throw error;
        }
    }
    
    // Compare BLM features with our hosted data to find changes
    function compareAndCategorizeChanges(blmFeatures, ourFeatures) {
        const ourClaimsMap = new Map();
        ourFeatures.forEach(f => {
            if (f.attributes && f.attributes.CSE_NR) {
                ourClaimsMap.set(f.attributes.CSE_NR, {
                    modified: f.attributes.Modified,
                    objectId: f.attributes.OBJECTID
                });
            }
        });
        
        const blmClaimsMap = new Map();
        blmFeatures.forEach(f => {
            if (f.attributes && f.attributes.CSE_NR) {
                blmClaimsMap.set(f.attributes.CSE_NR, f);
            }
        });
        
        const changes = {
            new: [],
            modified: [],
            deleted: []
        };
        
        // Find new and modified
        blmClaimsMap.forEach((blmFeature, claimId) => {
            if (!ourClaimsMap.has(claimId)) {
                changes.new.push(blmFeature);
            } else {
                const ourClaim = ourClaimsMap.get(claimId);
                if (ourClaim && blmFeature.attributes.Modified && ourClaim.modified) {
                    if (new Date(blmFeature.attributes.Modified) > new Date(ourClaim.modified)) {
                        changes.modified.push(blmFeature);
                    }
                }
            }
        });
        
        // Find deleted (in ours but not in recent BLM data)
        // Note: This is limited by the date range query
        ourClaimsMap.forEach((claimInfo, claimId) => {
            if (!blmClaimsMap.has(claimId)) {
                changes.deleted.push({
                    claimId: claimId,
                    objectId: claimInfo.objectId
                });
            }
        });
        
        return changes;
    }
    
    // Process change detection results
    async function processChangeResults(changes) {
        // Update UI
        document.getElementById("newClaimsCount").textContent = changes.new.length;
        document.getElementById("modifiedClaimsCount").textContent = changes.modified.length;
        document.getElementById("deletedClaimsCount").textContent = changes.deleted.length;
        document.getElementById("changeSummary").style.display = "block";
        
        // Store results for export
        app.changeDetection.lastResults = {
            ...changes,
            timestamp: new Date(),
            sinceDate: getSinceDate()
        };
        
        // Apply changes to hosted layer if any found
        if (changes.new.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0) {
            if (confirm(`Apply ${changes.new.length + changes.modified.length + changes.deleted.length} changes to your hosted data?`)) {
                await applyChangesToHosted(changes);
                await logChangesToHistory(changes);
                await updateStatistics();
            }
        }
    }
    
    // Apply changes to hosted feature layer
    async function applyChangesToHosted(changes) {
        try {
            const edits = {
                addFeatures: [],
                updateFeatures: [],
                deleteFeatures: []
            };
            
            // Prepare new features
            changes.new.forEach(feature => {
                edits.addFeatures.push({
                    geometry: feature.geometry,
                    attributes: feature.attributes
                });
            });
            
            // Prepare updates
            for (const feature of changes.modified) {
                const query = app.hostedClaimsLayer.createQuery();
                query.where = `CSE_NR = '${feature.attributes.CSE_NR}'`;
                query.outFields = ["OBJECTID"];
                const result = await app.hostedClaimsLayer.queryFeatures(query);
                
                if (result.features.length > 0) {
                    edits.updateFeatures.push({
                        geometry: feature.geometry,
                        attributes: {
                            ...feature.attributes,
                            OBJECTID: result.features[0].attributes.OBJECTID
                        }
                    });
                }
            }
            
            // Prepare deletions
            changes.deleted.forEach(change => {
                if (change.objectId) {
                    edits.deleteFeatures.push({
                        objectId: change.objectId
                    });
                }
            });
            
            // Apply edits
            if (edits.addFeatures.length > 0 || edits.updateFeatures.length > 0 || edits.deleteFeatures.length > 0) {
                const result = await app.hostedClaimsLayer.applyEdits(edits);
                console.log("Applied edits to hosted layer:", result);
                showMessage("Changes applied to hosted data successfully", "success");
            }
            
        } catch (error) {
            console.error("Error applying changes:", error);
            showMessage("Error applying changes to hosted layer", "error");
        }
    }
    
    // Log changes to history layer
    async function logChangesToHistory(changes) {
        try {
            const historyFeatures = [];
            const changeDate = Date.now();
            
            // Log new claims
            changes.new.forEach(feature => {
                historyFeatures.push({
                    geometry: {
                        type: "point",
                        x: feature.attributes.CASE_LND_LONGITUDE || -115,
                        y: feature.attributes.CASE_LND_LATITUDE || 40
                    },
                    attributes: {
                        change_id: `NEW_${feature.attributes.CSE_NR}_${changeDate}`,
                        change_date: changeDate,
                        change_type: "new",
                        claim_id: feature.attributes.CSE_NR,
                        claim_name: feature.attributes.CSE_NAME || "Unknown",
                        state: feature.attributes.ADMIN_STATE || "UNK",
                        county: feature.attributes.ADMIN_CNTY || "Unknown",
                        acres: feature.attributes.RCRD_ACRS || 0,
                        new_status: feature.attributes.CSE_DISP || "Active"
                    }
                });
            });
            
            // Log modified claims
            changes.modified.forEach(feature => {
                historyFeatures.push({
                    geometry: {
                        type: "point",
                        x: feature.attributes.CASE_LND_LONGITUDE || -115,
                        y: feature.attributes.CASE_LND_LATITUDE || 40
                    },
                    attributes: {
                        change_id: `MOD_${feature.attributes.CSE_NR}_${changeDate}`,
                        change_date: changeDate,
                        change_type: "modified",
                        claim_id: feature.attributes.CSE_NR,
                        claim_name: feature.attributes.CSE_NAME || "Unknown",
                        state: feature.attributes.ADMIN_STATE || "UNK",
                        county: feature.attributes.ADMIN_CNTY || "Unknown",
                        acres: feature.attributes.RCRD_ACRS || 0,
                        new_status: feature.attributes.CSE_DISP || "Active"
                    }
                });
            });
            
            // Log deleted claims
            changes.deleted.forEach(change => {
                historyFeatures.push({
                    geometry: {
                        type: "point",
                        x: -115,
                        y: 40
                    },
                    attributes: {
                        change_id: `DEL_${change.claimId}_${changeDate}`,
                        change_date: changeDate,
                        change_type: "deleted",
                        claim_id: change.claimId,
                        claim_name: "DELETED",
                        state: "UNK",
                        county: "Unknown",
                        acres: 0,
                        old_status: "Active",
                        new_status: "Deleted"
                    }
                });
            });
            
            // Add to history layer
            if (historyFeatures.length > 0) {
                const result = await app.changeHistoryLayer.applyEdits({
                    addFeatures: historyFeatures
                });
                console.log("Logged changes to history:", result);
            }
            
        } catch (error) {
            console.error("Error logging changes to history:", error);
            // Don't show error to user - history logging is supplementary
        }
    }
    
    // Create a new AOI
    async function createAOI(graphic) {
        const name = prompt("Enter a name for this monitoring area:");
        if (!name) return;
        
        const description = prompt("Enter a description (optional):");
        
        try {
            // Count claims in AOI
            const query = app.hostedClaimsLayer.createQuery();
            query.geometry = graphic.geometry;
            query.spatialRelationship = "intersects";
            const count = await app.hostedClaimsLayer.queryFeatureCount(query);
            
            // Create feature
            const feature = {
                geometry: graphic.geometry,
                attributes: {
                    aoi_name: name,
                    description: description || "",
                    created_date: Date.now(),
                    total_claims: count,
                    recent_changes: 0,
                    last_analysis: Date.now()
                }
            };
            
            // Add to portal
            const result = await app.aoiFeatureLayer.applyEdits({
                addFeatures: [feature]
            });
            
            if (result.addFeatureResults && result.addFeatureResults.length > 0) {
                showMessage(`AOI "${name}" created with ${count} claims`, "success");
                await loadAOIsFromPortal();
            } else {
                showMessage("Error creating AOI", "error");
            }
            
            // Clear drawing
            app.aoiDrawingLayer.removeAll();
            
        } catch (error) {
            console.error("Error creating AOI:", error);
            showMessage("Error creating AOI", "error");
        }
    }
    
    // Load AOIs from portal
    async function loadAOIsFromPortal() {
        try {
            const query = app.aoiFeatureLayer.createQuery();
            query.where = "1=1";
            query.returnGeometry = true;
            query.outFields = ["*"];
            
            const results = await app.aoiFeatureLayer.queryFeatures(query);
            
            app.aois = results.features.map(feature => ({
                id: feature.attributes.OBJECTID,
                name: feature.attributes.aoi_name,
                description: feature.attributes.description,
                geometry: feature.geometry,
                created: new Date(feature.attributes.created_date),
                claimCount: feature.attributes.total_claims || 0,
                recentChanges: feature.attributes.recent_changes || 0
            }));
            
            updateAOIList();
            
        } catch (error) {
            console.error("Error loading AOIs:", error);
        }
    }
    
    // Update AOI list display
    function updateAOIList() {
        const listDiv = document.getElementById("aoiList");
        
        if (app.aois.length === 0) {
            listDiv.innerHTML = '<div class="loading">No AOIs created yet</div>';
            return;
        }
        
        listDiv.innerHTML = app.aois.map(aoi => `
            <div class="aoi-item" data-id="${aoi.id}">
                <div>
                    <div class="aoi-name">${aoi.name}</div>
                    <div class="aoi-stats">${aoi.claimCount} claims, ${aoi.recentChanges} recent changes</div>
                </div>
                <button class="button secondary" style="width: auto; padding: 5px 10px;" 
                        onclick="zoomToAOI(${aoi.id})">Zoom</button>
            </div>
        `).join('');
    }
    
    // Analyze all AOIs for changes
    async function analyzeAllAOIs() {
        if (app.aois.length === 0) {
            showMessage("No AOIs to analyze", "info");
            return;
        }
        
        showMessage("Analyzing AOIs for changes...", "info");
        
        try {
            const results = [];
            
            for (const aoi of app.aois) {
                // Query changes within AOI
                const changeQuery = app.changeHistoryLayer.createQuery();
                changeQuery.geometry = aoi.geometry;
                changeQuery.spatialRelationship = "intersects";
                changeQuery.where = "1=1";
                changeQuery.outFields = ["change_type"];
                
                const changeResults = await app.changeHistoryLayer.queryFeatures(changeQuery);
                
                const analysis = {
                    name: aoi.name,
                    totalClaims: aoi.claimCount,
                    totalChanges: changeResults.features.length,
                    newClaims: changeResults.features.filter(f => f.attributes.change_type === "new").length,
                    modifiedClaims: changeResults.features.filter(f => f.attributes.change_type === "modified").length,
                    deletedClaims: changeResults.features.filter(f => f.attributes.change_type === "deleted").length
                };
                
                results.push(analysis);
            }
            
            displayAOIAnalysis(results);
            
        } catch (error) {
            console.error("Error analyzing AOIs:", error);
            showMessage("Error analyzing AOIs", "error");
        }
    }
    
    // Display AOI analysis results
    function displayAOIAnalysis(results) {
        const resultsDiv = document.getElementById("aoiSummaryResults");
        const analysisDiv = document.getElementById("aoiAnalysis");
        
        resultsDiv.innerHTML = results.map(result => `
            <div class="stat-card">
                <h4>${result.name}</h4>
                <div>Claims: ${result.totalClaims}</div>
                <div>Changes: ${result.totalChanges} (${result.newClaims} new, ${result.modifiedClaims} modified, ${result.deletedClaims} deleted)</div>
            </div>
        `).join('');
        
        analysisDiv.style.display = "block";
        showMessage("AOI analysis completed", "success");
    }
    
    // Update statistics
    async function updateStatistics() {
        try {
            if (!app.hostedClaimsLayer || !app.hostedClaimsLayer.loaded) {
                return;
            }
            
            // Total claims
            const totalQuery = app.hostedClaimsLayer.createQuery();
            totalQuery.where = "1=1";
            const totalCount = await app.hostedClaimsLayer.queryFeatureCount(totalQuery);
            app.statistics.total = totalCount;
            document.getElementById("totalClaims").textContent = totalCount.toLocaleString();
            
            // Recent changes
            const today = new Date();
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const recentQuery = app.hostedClaimsLayer.createQuery();
            recentQuery.where = `Modified >= '${weekAgo.toISOString().split('T')[0]}'`;
            const recentCount = await app.hostedClaimsLayer.queryFeatureCount(recentQuery);
            app.statistics.recent = recentCount;
            document.getElementById("recentChanges").textContent = recentCount.toLocaleString();
            
            // Update view statistics
            updateStatisticsInView();
            
        } catch (error) {
            console.error("Error updating statistics:", error);
        }
    }
    
    // Update statistics for current view
    async function updateStatisticsInView() {
        if (!app.view.stationary) return;
        
        try {
            const viewQuery = app.hostedClaimsLayer.createQuery();
            viewQuery.geometry = app.view.extent;
            viewQuery.spatialRelationship = "intersects";
            
            if (app.currentFilter !== "all") {
                viewQuery.where = app.hostedClaimsLayer.definitionExpression;
            }
            
            const viewCount = await app.hostedClaimsLayer.queryFeatureCount(viewQuery);
            app.statistics.inView = viewCount;
            document.getElementById("claimsInView").textContent = viewCount.toLocaleString();
            
        } catch (error) {
            console.error("Error updating view statistics:", error);
        }
    }
    
    // Check BLM service status
    async function checkBLMServiceStatus() {
        const status = { available: false, error: null };
        
        try {
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "?f=json");
            if (response.ok) {
                const data = await response.json();
                if (!data.error) {
                    status.available = true;
                    updateServiceStatusIndicator("blmActiveIndicator", true);
                }
            }
        } catch (error) {
            status.error = error.message;
            updateServiceStatusIndicator("blmActiveIndicator", false);
        }
        
        return status;
    }
    
    // Check all service statuses
    async function checkServiceStatus() {
        // Check BLM services
        try {
            const blmCheck = await checkBLMServiceStatus();
            app.serviceStatus.blmActive = blmCheck.available;
            
            // Update status display
            const statusText = blmCheck.available ? "Online" : "Offline";
            document.getElementById("serviceStatus").innerHTML = 
                `BLM Service: <span class="sync-indicator ${blmCheck.available ? 'online' : 'offline'}"></span> ${statusText}`;
                
        } catch (error) {
            console.error("Error checking service status:", error);
        }
    }
    
    // Utility functions
    function getSinceDate() {
        const inputDate = document.getElementById("checkSinceDate").value;
        if (inputDate) {
            return new Date(inputDate);
        } else {
            const stored = localStorage.getItem(CONFIG.storage.lastCheck);
            if (stored) {
                return new Date(stored);
            } else {
                return new Date(Date.now() - CONFIG.changeDetection.defaultDateRange * 24 * 60 * 60 * 1000);
            }
        }
    }
    
    function initializeDatePicker() {
        const dateInput = document.getElementById("checkSinceDate");
        const defaultDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
        dateInput.value = defaultDate.toISOString().split('T')[0];
    }
    
    function updateUserInfo(user) {
    console.log("updateUserInfo called with:", user);
    const userInfoElement = document.getElementById("userInfo");
    if (user && user.username) {
        userInfoElement.textContent = user.username;
        console.log("Set username to:", user.username);
    } else {
        userInfoElement.textContent = "Not logged in";
        console.log("No user or username found");
    }
}
    
    function updateServiceStatusIndicator(indicatorId, isOnline) {
        const indicator = document.getElementById(indicatorId);
        if (indicator) {
            indicator.className = `sync-indicator ${isOnline ? 'online' : 'offline'}`;
        }
    }
    
    function updateLastCheckDisplay() {
        if (app.lastExtractTime) {
            document.getElementById("lastCheckTime").textContent = 
                `Last check: ${app.lastExtractTime.toLocaleString()}`;
        }
    }
    
    function setupAutoCheck(frequency) {
        // Clear existing interval
        if (app.autoCheckInterval) {
            clearInterval(app.autoCheckInterval);
            app.autoCheckInterval = null;
        }
        
        if (frequency === "manual") {
            document.getElementById("nextCheckTime").style.display = "none";
            return;
        }
        
        let intervalMs;
        switch (frequency) {
            case "hourly":
                intervalMs = 60 * 60 * 1000;
                break;
            case "daily":
                intervalMs = 24 * 60 * 60 * 1000;
                break;
        }
        
        if (intervalMs) {
            app.autoCheckInterval = setInterval(checkForChanges, intervalMs);
            
            const nextCheck = new Date(Date.now() + intervalMs);
            document.getElementById("nextCheckTime").style.display = "block";
            document.getElementById("nextCheckTime").querySelector("span").textContent = 
                nextCheck.toLocaleString();
        }
    }
    
    // Export functions
    function exportChangeReport() {
        if (!app.changeDetection.lastResults) {
            showMessage("No change results to export", "info");
            return;
        }
        
        const results = app.changeDetection.lastResults;
        const csv = generateChangeReportCSV(results);
        downloadCSV(csv, `ClaimWatch_Changes_${results.timestamp.toISOString().split('T')[0]}.csv`);
    }
    
    function exportAOIReport() {
        if (app.aois.length === 0) {
            showMessage("No AOIs to export", "info");
            return;
        }
        
        const csv = generateAOIReportCSV(app.aois);
        downloadCSV(csv, `ClaimWatch_AOIs_${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    function generateChangeReportCSV(results) {
        const csv = [];
        csv.push("Type,Claim_ID,Claim_Name,State,County,Acres,Date,Longitude,Latitude");
        
        // Add changes
        results.new.forEach(feature => {
            const attrs = feature.attributes;
            csv.push(`New,${attrs.CSE_NR},${attrs.CSE_NAME},${attrs.ADMIN_STATE},${attrs.ADMIN_CNTY},${attrs.RCRD_ACRS},${attrs.Modified},${attrs.CASE_LND_LONGITUDE},${attrs.CASE_LND_LATITUDE}`);
        });
        
        results.modified.forEach(feature => {
            const attrs = feature.attributes;
            csv.push(`Modified,${attrs.CSE_NR},${attrs.CSE_NAME},${attrs.ADMIN_STATE},${attrs.ADMIN_CNTY},${attrs.RCRD_ACRS},${attrs.Modified},${attrs.CASE_LND_LONGITUDE},${attrs.CASE_LND_LATITUDE}`);
        });
        
        results.deleted.forEach(change => {
            csv.push(`Deleted,${change.claimId},DELETED,,,,,`);
        });
        
        return csv.join("\n");
    }
    
    function generateAOIReportCSV(aois) {
        const csv = [];
        csv.push("AOI_Name,Description,Created_Date,Total_Claims,Recent_Changes");
        
        aois.forEach(aoi => {
            csv.push(`${aoi.name},${aoi.description || ""},${aoi.created.toISOString().split('T')[0]},${aoi.claimCount},${aoi.recentChanges}`);
        });
        
        return csv.join("\n");
    }
    
    function downloadCSV(csvContent, filename) {
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    function showMessage(text, type = "info") {
        const messageDiv = document.getElementById("messageDiv");
        messageDiv.textContent = text;
        messageDiv.style.background = 
            type === "success" ? "#28a745" : 
            type === "error" ? "#dc3545" : "#17a2b8";
        messageDiv.style.display = "block";
        
        setTimeout(() => {
            messageDiv.style.display = "none";
        }, CONFIG.ui.messageTimeout);
    }
    
    // Global functions (called from HTML)
    window.zoomToAOI = function(aoiId) {
        const aoi = app.aois.find(a => a.id === aoiId);
        if (aoi && aoi.geometry) {
            app.view.goTo(aoi.geometry);
        }
    };
    // Global sign-in function
    window.signIn = function() {
        IdentityManager.getCredential(portal.url).then(function(credential) {
            // Force reload the portal with new credentials
            portal.user = null; // Clear cached user
            return portal.load();
        }).then(function() {
            console.log("Portal reloaded, user:", portal.user);
            if (portal.user) {
                updateUserInfo(portal.user);
                showMessage("Signed in as " + portal.user.username, "success");
            } else {
                // Try one more time to get user info
                setTimeout(() => {
                    portal.load().then(() => {
                        console.log("Second attempt, user:", portal.user);
                        updateUserInfo(portal.user);
                    });
                }, 1000);
            }
        }).catch(function(error) {
            console.error("Sign-in error:", error);
            showMessage("Sign-in failed", "error");
        });
    };
    // Initialize the application
    init();
});
