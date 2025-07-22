/**
 * ClaimWatch Pro - Complete Application with BLM Integration
 * UPDATED VERSION with Change Detection Fixes
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
        
        // Change detection state - FIXED
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
            
            // Initialize change detection - FIXED
            initializeChangeDetection();
            
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
    
    // Set up BLM Map Layers for fast visualization
    async function setupBLMMapLayers() {
        try {
            // BLM Active Claims Map Layer
            app.blmActiveMapLayer = new MapImageLayer({
                url: CONFIG.blmServices.notClosedMap,
                title: "BLM Active Claims (Live)",
                opacity: 0.7,
                visible: true
            });
            
            // BLM Closed Claims Map Layer  
            app.blmClosedMapLayer = new MapImageLayer({
                url: CONFIG.blmServices.closedMap,
                title: "BLM Closed Claims (Live)",
                opacity: 0.5,
                visible: false
            });
            
            app.view.map.addMany([app.blmActiveMapLayer, app.blmClosedMapLayer]);
            console.log("BLM Map layers added");
            
        } catch (error) {
            console.error("Error setting up BLM map layers:", error);
            throw error;
        }
    }
    
    // Set up hosted feature layers
    async function setupHostedLayers() {
        try {
            // Your hosted claims layer (complete dataset)
            app.hostedClaimsLayer = new FeatureLayer({
                url: CONFIG.hostedServices.claims.url,
                title: "My Hosted Claims (Complete Dataset)",
                visible: true,
                opacity: 0.8,
                renderer: {
                    type: "simple",
                    symbol: {
                        type: "simple-fill",
                        color: [255, 255, 0, 0.6],
                        outline: {
                            color: [255, 255, 0, 0.8],
                            width: 2
                        }
                    }
                },
                popupTemplate: {
                    title: "Mining Claim: {CSE_NAME}",
                    content: [
                        {
                            type: "fields",
                            fieldInfos: [
                                { fieldName: "CSE_NR", label: "Case Number" },
                                { fieldName: "CSE_DISP", label: "Disposition" },
                                { fieldName: "RCRD_ACRS", label: "Acres" },
                                { fieldName: "Created", label: "Created" },
                                { fieldName: "Modified", label: "Modified" }
                            ]
                        }
                    ]
                }
            });
            
            // Change history layer
            app.changeHistoryLayer = new FeatureLayer({
                url: CONFIG.hostedServices.changeHistory.url,
                title: "Change History",
                visible: false
            });
            
            app.view.map.addMany([app.hostedClaimsLayer, app.changeHistoryLayer]);
            console.log("Hosted layers added");
            
        } catch (error) {
            console.error("Error setting up hosted layers:", error);
            throw error;
        }
    }
    
    // Set up interactive layers (AOIs, graphics)
    async function setupInteractiveLayers() {
        try {
            // AOI drawing layer
            app.aoiDrawingLayer = new GraphicsLayer({
                title: "AOI Drawing Layer"
            });
            
            app.view.map.add(app.aoiDrawingLayer);
            
            // Set up sketch widget for AOI drawing
            app.sketch = new Sketch({
                layer: app.aoiDrawingLayer,
                view: app.view,
                creationMode: "update"
            });
            
            console.log("Interactive layers added");
            
        } catch (error) {
            console.error("Error setting up interactive layers:", error);
            throw error;
        }
    }
    
    // Set up widgets
    function setupWidgets() {
        // Search widget
        const searchWidget = new Search({
            view: app.view
        });
        app.view.ui.add(searchWidget, "top-right");
        
        // Layer list
        const layerList = new LayerList({
            view: app.view
        });
        
        const layerListExpand = new Expand({
            view: app.view,
            content: layerList
        });
        app.view.ui.add(layerListExpand, "top-left");
        
        // Legend
        const legend = new Legend({
            view: app.view
        });
        
        const legendExpand = new Expand({
            view: app.view,
            content: legend
        });
        app.view.ui.add(legendExpand, "bottom-left");
    }
    
    // Set up event handlers - FIXED
    function setupEventHandlers() {
        // Layer visibility controls
        document.getElementById("hostedClaimsToggle").addEventListener("change", function(e) {
            app.hostedClaimsLayer.visible = e.target.checked;
        });
        
        document.getElementById("blmActiveToggle").addEventListener("change", function(e) {
            app.blmActiveMapLayer.visible = e.target.checked;
        });
        
        document.getElementById("blmClosedToggle").addEventListener("change", function(e) {
            app.blmClosedMapLayer.visible = e.target.checked;
        });
        
        document.getElementById("changeHistoryToggle").addEventListener("change", function(e) {
            app.changeHistoryLayer.visible = e.target.checked;
        });
        
        // Layer opacity controls
        document.getElementById("hostedOpacity").addEventListener("input", function(e) {
            app.hostedClaimsLayer.opacity = e.target.value / 100;
        });
        
        document.getElementById("blmActiveOpacity").addEventListener("input", function(e) {
            app.blmActiveMapLayer.opacity = e.target.value / 100;
        });
        
        document.getElementById("blmClosedOpacity").addEventListener("input", function(e) {
            app.blmClosedMapLayer.opacity = e.target.value / 100;
        });
        
        // Filter buttons
        document.getElementById("filterAll").addEventListener("click", function() {
            setFilter("all");
        });
        
        document.getElementById("filterRecent").addEventListener("click", function() {
            setFilter("recent");
        });
        
        document.getElementById("filterPaymentRisk").addEventListener("click", function() {
            setFilter("paymentRisk");
        });
        
        // AOI controls
        document.getElementById("drawAOI").addEventListener("click", function() {
            startAOIDrawing();
        });
        
        document.getElementById("clearDrawing").addEventListener("click", function() {
            clearAOIDrawing();
        });
        
        // Change detection controls - FIXED EVENT HANDLERS
        const checkButton = document.getElementById("checkChanges");
        if (checkButton) {
            checkButton.addEventListener("click", function(e) {
                e.preventDefault();
                checkForChanges();
            });
        }
        
        // Auto-check frequency
        document.getElementById("autoCheckFrequency").addEventListener("change", function(e) {
            setupAutoCheck(e.target.value);
        });
        
        // AOI analysis controls
        document.getElementById("analyzeAOIs").addEventListener("click", function(e) {
            e.preventDefault();
            analyzeAllAOIs();
        });
        
        document.getElementById("exportAOIReport").addEventListener("click", function(e) {
            e.preventDefault();
            exportAOIReport();
        });
        
        // Sketch event handlers
        app.sketch.on("create", function(event) {
            if (event.state === "complete") {
                addAOI(event.graphic);
            }
        });
        
        app.sketch.on("update", function(event) {
            if (event.state === "complete") {
                updateAOI(event.graphics[0]);
            }
        });
    }
    
    // FIXED: Service status check function
    async function checkBLMServiceStatus() {
        const status = { available: false, error: null };
        
        try {
            // Use the correct BLM service URL from CONFIG
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "?f=json", {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                // Check if the response has the expected structure
                if (data && data.name && !data.error) {
                    status.available = true;
                    console.log("BLM Service Available:", data.name);
                    updateServiceStatusIndicator("blmActiveIndicator", true);
                } else {
                    status.error = data.error ? data.error.message : "Invalid service response";
                    updateServiceStatusIndicator("blmActiveIndicator", false);
                }
            } else {
                status.error = `HTTP ${response.status}: ${response.statusText}`;
                updateServiceStatusIndicator("blmActiveIndicator", false);
            }
        } catch (error) {
            status.error = error.message;
            updateServiceStatusIndicator("blmActiveIndicator", false);
            console.error("BLM Service Check Error:", error);
        }
        
        return status;
    }
    
    // FIXED: Service status indicator update
    function updateServiceStatusIndicator(indicatorId, isOnline) {
        const indicator = document.getElementById(indicatorId);
        if (indicator) {
            indicator.className = `sync-indicator ${isOnline ? 'online' : 'offline'}`;
        }
        
        // Update the main service status display
        const statusText = isOnline ? "Online" : "Offline";
        const serviceStatusElement = document.getElementById("serviceStatus");
        if (serviceStatusElement) {
            serviceStatusElement.innerHTML = 
                `BLM Service: <span class="sync-indicator ${isOnline ? 'online' : 'offline'}"></span> ${statusText}`;
        }
    }
    
    // Check service status for all services
    async function checkServiceStatus() {
        try {
            // Check BLM services
            const blmCheck = await checkBLMServiceStatus();
            app.serviceStatus.blmActive = blmCheck.available;
            
            // Update status display
            const statusText = blmCheck.available ? "Online" : "Offline";
            const serviceStatusElement = document.getElementById("serviceStatus");
            if (serviceStatusElement) {
                serviceStatusElement.innerHTML = 
                    `BLM Service: <span class="sync-indicator ${blmCheck.available ? 'online' : 'offline'}"></span> ${statusText}`;
            }
                
        } catch (error) {
            console.error("Error checking service status:", error);
        }
    }
    
    // FIXED: Date formatting function
    function formatDateForQuery(date) {
        // Use ISO format for ArcGIS queries instead of 'short-date-time'
        if (date instanceof Date) {
            return date.toISOString();
        } else if (typeof date === 'string') {
            return new Date(date).toISOString();
        }
        return new Date().toISOString();
    }
    
    // FIXED: Get since date function
    function getSinceDate() {
        const dateInput = document.getElementById("checkSinceDate");
        if (dateInput && dateInput.value) {
            return new Date(dateInput.value);
        } else {
            // Default to stored last check or 30 days ago
            const stored = localStorage.getItem(CONFIG.storage.lastCheck);
            if (stored) {
                return new Date(stored);
            } else {
                return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            }
        }
    }
    
    // FIXED: Initialize date picker
    function initializeDatePicker() {
        const dateInput = document.getElementById("checkSinceDate");
        if (dateInput) {
            // Set default to 30 days ago
            const defaultDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            dateInput.value = defaultDate.toISOString().split('T')[0];
        }
    }
    
    // FIXED: Initialize change detection
    function initializeChangeDetection() {
        // Initialize date picker
        initializeDatePicker();
        
        // Update last check display
        updateLastCheckDisplay();
        
        // Check service status
        checkBLMServiceStatus().then(status => {
            console.log("Initial BLM service status:", status);
        });
        
        console.log("Change detection initialized");
    }
    
    // FIXED: Update last check display
    function updateLastCheckDisplay() {
        const lastCheckElement = document.getElementById("lastCheck");
        if (lastCheckElement) {
            const lastCheck = localStorage.getItem(CONFIG.storage.lastCheck);
            if (lastCheck) {
                const date = new Date(lastCheck);
                lastCheckElement.textContent = date.toLocaleString();
            } else {
                lastCheckElement.textContent = "Never";
            }
        }
    }
    
    // FIXED: Main change detection function
    async function checkForChanges() {
        if (app.changeDetection && app.changeDetection.isRunning) {
            showMessage("Change detection already in progress...", "info");
            return;
        }
        
        const button = document.getElementById("checkChanges");
        const indicator = document.getElementById("changeCheckIndicator");
        
        try {
            // Initialize change detection state if not exists
            if (!app.changeDetection) {
                app.changeDetection = { isRunning: false, lastResults: null };
            }
            
            app.changeDetection.isRunning = true;
            
            if (button) {
                button.disabled = true;
                button.textContent = "Checking...";
            }
            
            if (indicator) {
                indicator.className = "sync-indicator checking";
            }
            
            showMessage("Checking BLM for changes...", "info");
            
            // Check service availability first
            const serviceCheck = await checkBLMServiceStatus();
            if (!serviceCheck.available) {
                throw new Error(`BLM service unavailable: ${serviceCheck.error}`);
            }
            
            // Get date range for checking
            const sinceDate = getSinceDate();
            console.log("Checking for changes since:", sinceDate);
            
            // Perform change detection
            const changes = await detectChangesByComparison(sinceDate);
            
            // Update UI with results
            updateChangeResults(changes);
            
            // Update last check time
            localStorage.setItem(CONFIG.storage.lastCheck, new Date().toISOString());
            updateLastCheckDisplay();
            
            showMessage(`Change detection completed. Found ${changes.new.length} new, ${changes.modified.length} modified, ${changes.deleted.length} deleted claims.`, "success");
            
        } catch (error) {
            console.error("Change detection error:", error);
            showMessage("Error checking for changes: " + error.message, "error");
        } finally {
            if (app.changeDetection) {
                app.changeDetection.isRunning = false;
            }
            
            if (button) {
                button.disabled = false;
                button.textContent = "Check for Changes Now";
            }
            
            if (indicator) {
                indicator.className = "sync-indicator offline";
            }
        }
    }
    
    // FIXED: Change detection by comparison
    async function detectChangesByComparison(sinceDate) {
        const changes = {
            new: [],
            modified: [],
            deleted: [],
            timestamp: new Date(),
            sinceDate: sinceDate
        };
        
        try {
            // Query BLM services for recent changes
            const notClosedQuery = {
                where: `Modified >= timestamp '${formatDateForQuery(sinceDate)}'`,
                outFields: "*",
                f: "json",
                resultRecordCount: 2000
            };
            
            const closedQuery = {
                where: `Modified >= timestamp '${formatDateForQuery(sinceDate)}'`,
                outFields: "*", 
                f: "json",
                resultRecordCount: 2000
            };
            
            // Query both services
            const [notClosedResponse, closedResponse] = await Promise.all([
                queryBLMService(CONFIG.blmServices.notClosedFeatures, notClosedQuery),
                queryBLMService(CONFIG.blmServices.closedFeatures, closedQuery)
            ]);
            
            // Process results
            if (notClosedResponse && notClosedResponse.features) {
                for (const feature of notClosedResponse.features) {
                    const createdDate = new Date(feature.attributes.Created);
                    const modifiedDate = new Date(feature.attributes.Modified);
                    
                    if (createdDate >= sinceDate) {
                        changes.new.push(feature);
                    } else if (modifiedDate >= sinceDate) {
                        changes.modified.push(feature);
                    }
                }
            }
            
            if (closedResponse && closedResponse.features) {
                // Closed claims are typically deletions from active claims
                changes.deleted.push(...closedResponse.features);
            }
            
            console.log("Change detection results:", changes);
            return changes;
            
        } catch (error) {
            console.error("Error in detectChangesByComparison:", error);
            throw error;
        }
    }
    
    // FIXED: BLM service query helper
    async function queryBLMService(serviceUrl, queryParams) {
        try {
            const queryString = new URLSearchParams(queryParams).toString();
            const url = `${serviceUrl}/query?${queryString}`;
            
            console.log("Querying BLM service:", url);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message || "BLM service query error");
            }
            
            return data;
        } catch (error) {
            console.error("BLM service query error:", error);
            throw error;
        }
    }
    
    // FIXED: Update change results display
    function updateChangeResults(changes) {
        // Update dashboard statistics
        const newCount = document.getElementById("newClaimsCount");
        const modifiedCount = document.getElementById("modifiedClaimsCount");
        const deletedCount = document.getElementById("deletedClaimsCount");
        const recentChanges = document.getElementById("recentChanges");
        
        if (newCount) newCount.textContent = changes.new.length;
        if (modifiedCount) modifiedCount.textContent = changes.modified.length;
        if (deletedCount) deletedCount.textContent = changes.deleted.length;
        if (recentChanges) recentChanges.textContent = changes.new.length + changes.modified.length + changes.deleted.length;
        
        // Store results for export
        if (app.changeDetection) {
            app.changeDetection.lastResults = changes;
        }
        
        // Show change summary
        const changeSummary = document.getElementById("changeSummary");
        if (changeSummary) {
            changeSummary.style.display = "block";
        }
    }
    
    // Check if BLM service supports Extract Changes
    async function supportsExtractChanges() {
        try {
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "?f=json");
            const serviceInfo = await response.json();
            return serviceInfo.hasStaticData === false && serviceInfo.supportsExtractChanges === true;
        } catch (error) {
            console.error("Error checking Extract Changes support:", error);
            return false;
        }
    }
    
    // Extract changes using ArcGIS Extract Changes operation (if supported)
    async function extractChangesFromBLM(sinceDate) {
        try {
            const extractUrl = CONFIG.blmServices.notClosedFeatures + "/extractChanges";
            const params = {
                serverGen: Math.floor(sinceDate.getTime() / 1000),
                queries: JSON.stringify([{
                    layerId: 0,
                    where: "1=1"
                }]),
                f: "json"
            };
            
            const response = await fetch(extractUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams(params)
            });
            
            if (!response.ok) {
                throw new Error(`Extract Changes failed: ${response.statusText}`);
            }
            
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }
            
            return {
                new: data.edits?.adds || [],
                modified: data.edits?.updates || [],
                deleted: data.edits?.deletes || [],
                timestamp: new Date(),
                sinceDate: sinceDate
            };
            
        } catch (error) {
            console.error("Extract Changes error:", error);
            throw error;
        }
    }
    
    // Apply changes to hosted layer
    async function applyChangesToHosted(changes) {
        try {
            showMessage("Applying changes to hosted data...", "info");
            
            const edits = {
                addFeatures: changes.new,
                updateFeatures: changes.modified,
                deleteFeatures: changes.deleted.map(f => ({ objectId: f.attributes.OBJECTID }))
            };
            
            const result = await app.hostedClaimsLayer.applyEdits(edits);
            
            if (result.addFeatureResults.length > 0 || 
                result.updateFeatureResults.length > 0 || 
                result.deleteFeatureResults.length > 0) {
                showMessage("Changes applied successfully to hosted data", "success");
                await updateStatistics();
            }
            
        } catch (error) {
            console.error("Error applying changes:", error);
            showMessage("Error applying changes: " + error.message, "error");
        }
    }
    
    // Log changes to history
    async function logChangesToHistory(changes) {
        try {
            const historyFeatures = [];
            
            // Log new claims
            changes.new.forEach(feature => {
                historyFeatures.push({
                    attributes: {
                        claim_id: feature.attributes.ID,
                        change_type: "NEW",
                        change_date: new Date().getTime(),
                        details: `New claim: ${feature.attributes.CSE_NAME}`
                    },
                    geometry: feature.geometry
                });
            });
            
            // Log modified claims
            changes.modified.forEach(feature => {
                historyFeatures.push({
                    attributes: {
                        claim_id: feature.attributes.ID,
                        change_type: "MODIFIED",
                        change_date: new Date().getTime(),
                        details: `Modified claim: ${feature.attributes.CSE_NAME}`
                    },
                    geometry: feature.geometry
                });
            });
            
            // Log deleted claims
            changes.deleted.forEach(feature => {
                historyFeatures.push({
                    attributes: {
                        claim_id: feature.attributes.ID,
                        change_type: "DELETED",
                        change_date: new Date().getTime(),
                        details: `Deleted claim: ${feature.attributes.CSE_NAME}`
                    },
                    geometry: feature.geometry
                });
            });
            
            if (historyFeatures.length > 0) {
                await app.changeHistoryLayer.applyEdits({
                    addFeatures: historyFeatures
                });
                
                showMessage(`Logged ${historyFeatures.length} changes to history`, "info");
            }
            
        } catch (error) {
            console.error("Error logging changes:", error);
            showMessage("Error logging changes: " + error.message, "error");
        }
    }
    
    // Set up automatic checking
    function setupAutoCheck(frequency) {
        // Clear existing interval
        if (app.autoCheckInterval) {
            clearInterval(app.autoCheckInterval);
            app.autoCheckInterval = null;
        }
        
        let intervalMs = 0;
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
            const nextCheckElement = document.getElementById("nextCheckTime");
            if (nextCheckElement) {
                nextCheckElement.style.display = "block";
                const spanElement = nextCheckElement.querySelector("span");
                if (spanElement) {
                    spanElement.textContent = nextCheck.toLocaleString();
                }
            }
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
        downloadCSV(csv, `ClaimWatch_AOI_Report_${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    // Generate CSV for change report
    function generateChangeReportCSV(results) {
        let csv = "Type,Count,Details\n";
        csv += `New Claims,${results.new.length},Claims created since ${results.sinceDate.toISOString()}\n`;
        csv += `Modified Claims,${results.modified.length},Claims modified since ${results.sinceDate.toISOString()}\n`;
        csv += `Deleted Claims,${results.deleted.length},Claims closed/deleted since ${results.sinceDate.toISOString()}\n`;
        csv += `Total Changes,${results.new.length + results.modified.length + results.deleted.length},All changes since ${results.sinceDate.toISOString()}\n`;
        
        // Add detailed records
        csv += "\n\nDetailed Records:\n";
        csv += "Change Type,Claim ID,Case Name,Case Number,Acres,Created,Modified\n";
        
        results.new.forEach(feature => {
            const attrs = feature.attributes;
            csv += `NEW,"${attrs.ID}","${attrs.CSE_NAME || ''}","${attrs.CSE_NR || ''}","${attrs.RCRD_ACRS || ''}","${new Date(attrs.Created).toISOString()}","${new Date(attrs.Modified).toISOString()}"\n`;
        });
        
        results.modified.forEach(feature => {
            const attrs = feature.attributes;
            csv += `MODIFIED,"${attrs.ID}","${attrs.CSE_NAME || ''}","${attrs.CSE_NR || ''}","${attrs.RCRD_ACRS || ''}","${new Date(attrs.Created).toISOString()}","${new Date(attrs.Modified).toISOString()}"\n`;
        });
        
        results.deleted.forEach(feature => {
            const attrs = feature.attributes;
            csv += `DELETED,"${attrs.ID}","${attrs.CSE_NAME || ''}","${attrs.CSE_NR || ''}","${attrs.RCRD_ACRS || ''}","${new Date(attrs.Created).toISOString()}","${new Date(attrs.Modified).toISOString()}"\n`;
        });
        
        return csv;
    }
    
    // Generate CSV for AOI report
    function generateAOIReportCSV(aois) {
        let csv = "AOI Name,Created,Claims Count,Total Acres,Recent Changes\n";
        
        aois.forEach(aoi => {
            csv += `"${aoi.name}","${aoi.created.toISOString()}","${aoi.claimsCount || 0}","${aoi.totalAcres || 0}","${aoi.recentChanges || 0}"\n`;
        });
        
        return csv;
    }
    
    // Download CSV file
    function downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showMessage(`Downloaded: ${filename}`, "success");
    }
    
    // Filter functions
    function setFilter(filterType) {
        app.currentFilter = filterType;
        
        // Update button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.getElementById(`filter${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`).classList.add('active');
        
        // Apply filter
        applyFilter();
    }
    
    function applyFilter() {
        let whereClause = "1=1";
        
        switch (app.currentFilter) {
            case "recent":
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                whereClause = `Modified >= timestamp '${formatDateForQuery(sevenDaysAgo)}'`;
                break;
            case "paymentRisk":
                // Define payment risk criteria
                whereClause = "CSE_DISP IS NULL OR CSE_DISP = ''";
                break;
        }
        
        if (app.hostedClaimsLayer) {
            app.hostedClaimsLayer.definitionExpression = whereClause;
        }
        
        updateStatistics();
    }
    
    // AOI functions
    function startAOIDrawing() {
        app.sketch.create("polygon");
        showMessage("Click to start drawing an Area of Interest", "info");
    }
    
    function clearAOIDrawing() {
        app.aoiDrawingLayer.removeAll();
        app.aois = [];
        updateAOIList();
        showMessage("AOI drawing cleared", "info");
    }
    
    function addAOI(graphic) {
        const aoi = {
            id: Date.now(),
            name: `AOI ${app.aois.length + 1}`,
            geometry: graphic.geometry,
            created: new Date(),
            graphic: graphic
        };
        
        app.aois.push(aoi);
        updateAOIList();
        saveAOIsToPortal();
        showMessage(`AOI "${aoi.name}" added`, "success");
    }
    
    function updateAOI(graphic) {
        // Find and update existing AOI
        const aoi = app.aois.find(a => a.graphic === graphic);
        if (aoi) {
            aoi.geometry = graphic.geometry;
            saveAOIsToPortal();
            showMessage(`AOI "${aoi.name}" updated`, "success");
        }
    }
    
    function updateAOIList() {
        const aoiList = document.getElementById("aoiList");
        if (!aoiList) return;
        
        if (app.aois.length === 0) {
            aoiList.innerHTML = "<p>No AOIs created yet</p>";
            return;
        }
        
        aoiList.innerHTML = app.aois.map(aoi => 
            `<div class="aoi-item">
                <strong>${aoi.name}</strong>
                <span>Created: ${aoi.created.toLocaleDateString()}</span>
                <button onclick="removeAOI(${aoi.id})">Remove</button>
            </div>`
        ).join('');
    }
    
    function removeAOI(aoiId) {
        const index = app.aois.findIndex(aoi => aoi.id === aoiId);
        if (index > -1) {
            const aoi = app.aois[index];
            app.aoiDrawingLayer.remove(aoi.graphic);
            app.aois.splice(index, 1);
            updateAOIList();
            saveAOIsToPortal();
            showMessage(`AOI "${aoi.name}" removed`, "info");
        }
    }
    
    // Save AOIs to portal
    async function saveAOIsToPortal() {
        try {
            if (!app.aoiFeatureLayer) return;
            
            const features = app.aois.map(aoi => ({
                geometry: aoi.geometry,
                attributes: {
                    name: aoi.name,
                    created: aoi.created.getTime(),
                    aoi_id: aoi.id
                }
            }));
            
            // Clear existing and add new
            await app.aoiFeatureLayer.applyEdits({
                deleteFeatures: { where: "1=1" },
                addFeatures: features
            });
            
        } catch (error) {
            console.error("Error saving AOIs:", error);
        }
    }
    
    // Load AOIs from portal
    async function loadAOIsFromPortal() {
        try {
            if (!app.aoiFeatureLayer) return;
            
            const query = app.aoiFeatureLayer.createQuery();
            query.where = "1=1";
            query.returnGeometry = true;
            
            const results = await app.aoiFeatureLayer.queryFeatures(query);
            
            app.aois = results.features.map(feature => {
                const graphic = new Graphic({
                    geometry: feature.geometry,
                    symbol: {
                        type: "simple-fill",
                        color: [255, 0, 0, 0.3],
                        outline: {
                            color: [255, 0, 0, 0.8],
                            width: 2
                        }
                    }
                });
                
                app.aoiDrawingLayer.add(graphic);
                
                return {
                    id: feature.attributes.aoi_id,
                    name: feature.attributes.name,
                    geometry: feature.geometry,
                    created: new Date(feature.attributes.created),
                    graphic: graphic
                };
            });
            
            updateAOIList();
            
        } catch (error) {
            console.error("Error loading AOIs:", error);
        }
    }
    
    // Analyze all AOIs
    async function analyzeAllAOIs() {
        if (app.aois.length === 0) {
            showMessage("No AOIs to analyze", "info");
            return;
        }
        
        showMessage("Analyzing AOIs...", "info");
        
        try {
            for (const aoi of app.aois) {
                await analyzeAOI(aoi);
            }
            
            showMessage("AOI analysis completed", "success");
            
        } catch (error) {
            console.error("Error analyzing AOIs:", error);
            showMessage("Error analyzing AOIs: " + error.message, "error");
        }
    }
    
    // Analyze individual AOI
    async function analyzeAOI(aoi) {
        try {
            // Query claims within AOI
            const query = new Query({
                geometry: aoi.geometry,
                spatialRelationship: "intersects",
                returnGeometry: false,
                outFields: ["*"]
            });
            
            const results = await app.hostedClaimsLayer.queryFeatures(query);
            
            // Calculate statistics
            aoi.claimsCount = results.features.length;
            aoi.totalAcres = results.features.reduce((sum, feature) => 
                sum + (feature.attributes.RCRD_ACRS || 0), 0);
            
            // Check for recent changes
            const recentQuery = new Query({
                geometry: aoi.geometry,
                spatialRelationship: "intersects",
                where: `Modified >= timestamp '${formatDateForQuery(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))}'`,
                returnGeometry: false
            });
            
            const recentResults = await app.hostedClaimsLayer.queryFeatures(recentQuery);
            aoi.recentChanges = recentResults.features.length;
            
        } catch (error) {
            console.error(`Error analyzing AOI ${aoi.name}:`, error);
            throw error;
        }
    }
    
    // Statistics functions
    async function updateStatistics() {
        try {
            await updateTotalStatistics();
            await updateViewStatistics();
            await updateRecentStatistics();
            
        } catch (error) {
            console.error("Error updating statistics:", error);
        }
    }
    
    async function updateTotalStatistics() {
        try {
            if (!app.hostedClaimsLayer) return;
            
            const query = app.hostedClaimsLayer.createQuery();
            query.where = "1=1";
            
            const result = await app.hostedClaimsLayer.queryFeatureCount(query);
            app.statistics.total = result;
            
            const totalElement = document.getElementById("totalClaims");
            if (totalElement) {
                totalElement.textContent = result.toLocaleString();
            }
            
        } catch (error) {
            console.error("Error updating total statistics:", error);
        }
    }
    
    async function updateViewStatistics() {
        try {
            if (!app.hostedClaimsLayer || !app.view) return;
            
            const query = app.hostedClaimsLayer.createQuery();
            query.geometry = app.view.extent;
            query.spatialRelationship = "intersects";
            
            const result = await app.hostedClaimsLayer.queryFeatureCount(query);
            app.statistics.inView = result;
            
            const inViewElement = document.getElementById("claimsInView");
            if (inViewElement) {
                inViewElement.textContent = result.toLocaleString();
            }
            
        } catch (error) {
            console.error("Error updating view statistics:", error);
        }
    }
    
    async function updateRecentStatistics() {
        try {
            if (!app.hostedClaimsLayer) return;
            
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const query = app.hostedClaimsLayer.createQuery();
            query.where = `Modified >= timestamp '${formatDateForQuery(sevenDaysAgo)}'`;
            
            const result = await app.hostedClaimsLayer.queryFeatureCount(query);
            app.statistics.recent = result;
            
            const recentElement = document.getElementById("recentChanges");
            if (recentElement) {
                recentElement.textContent = result.toLocaleString();
            }
            
        } catch (error) {
            console.error("Error updating recent statistics:", error);
        }
    }
    
    function updateStatisticsInView() {
        updateViewStatistics();
    }
    
    // Message display function
    function showMessage(message, type = 'info') {
        const messageArea = document.getElementById('messageArea');
        if (!messageArea) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            return;
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `<strong>[${timestamp}]</strong> ${message}`;
        
        messageArea.appendChild(messageDiv);
        messageArea.scrollTop = messageArea.scrollHeight;
        
        // Auto-remove after 10 seconds for non-error messages
        if (type !== 'error') {
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 10000);
        }
    }
    
    // Global functions (accessible from HTML)
    window.checkForChanges = checkForChanges;
    window.exportChangeReport = exportChangeReport;
    window.exportAOIReport = exportAOIReport;
    window.analyzeAllAOIs = analyzeAllAOIs;
    window.removeAOI = removeAOI;
    window.signIn = function() {
        IdentityManager.getCredential(portalUrl);
    };
    
    // Initialize the application
    init();
    
}); // End of require function
