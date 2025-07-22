/**
 * ClaimWatch Pro - Complete Application with BLM Integration
 * REWRITTEN VERSION with Proper Change Detection
 * Implements robust BLM MLRS change detection and reporting
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
        
        // Update user info display
        updateUserInfo(portal);
        
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
        aoiGraphicsLayer: null,
        sketchLayer: null,
        
        // Widgets
        sketch: null,
        
        // Statistics
        statistics: {
            totalActive: 0,
            inView: 0,
            recent: 0
        },
        
        // Change detection state
        changeDetection: {
            isRunning: false,
            lastResults: null,
            lastCheck: null
        },
        
        // Auto-check interval
        autoCheckInterval: null
    };
    
    // Initialize the application
    async function initializeApp() {
        try {
            console.log("Initializing ClaimWatch Pro...");
            
            // Create map and view
            await createMapAndView();
            
            // Set up layers
            await setupLayers();
            
            // Set up widgets
            setupWidgets();
            
            // Set up event listeners
            setupEventListeners();
            
            // Initialize change detection
            initializeChangeDetection();
            
            // Start periodic updates
            setInterval(updateStatistics, CONFIG.refresh.statistics);
            setInterval(checkBLMServiceStatus, CONFIG.refresh.serviceStatus);
            
            showMessage("ClaimWatch Pro loaded successfully", "success");
            
        } catch (error) {
            console.error("Application initialization error:", error);
            showMessage("Error initializing application: " + error.message, "error");
        }
    }
    
    // Update user info display
    function updateUserInfo(portal) {
        const userInfoElement = document.getElementById("userInfo");
        if (!userInfoElement) return;
        
        if (portal.user) {
            userInfoElement.textContent = portal.user.username || "Authenticated User";
        } else if (portal.credential) {
            userInfoElement.textContent = "Signed In";
        } else {
            // Try to get current user
            IdentityManager.findCredential(portal.url).then(function(credential) {
                if (credential) {
                    userInfoElement.textContent = credential.userId || "Signed In";
                } else {
                    userInfoElement.innerHTML = 
                        '<button onclick="signIn()" style="background:#fff;color:#2b7bba;border:1px solid #2b7bba;padding:5px 10px;border-radius:3px;cursor:pointer;">Sign In</button>';
                }
            }).catch(function() {
                userInfoElement.textContent = "Login required";
            });
        }
    }
    
    // Create map and view
    async function createMapAndView() {
        // Create the map
        const map = new Map({
            basemap: "topo-vector"
        });
        
        // Create the view
        app.view = new MapView({
            container: "mapDiv",
            map: map,
            center: [-114.0, 39.0], // Nevada
            zoom: 7
        });
        
        await app.view.when();
        console.log("Map and view created successfully");
    }
    
    // Set up all layers
    async function setupLayers() {
        // Set up graphics layers first
        setupGraphicsLayers();
        
        // Set up hosted layers
        await setupHostedLayers();
        
        // Set up BLM layers
        await setupBLMLayers();
        
        console.log("All layers set up successfully");
    }
    
    // Set up graphics layers
    function setupGraphicsLayers() {
        // AOI graphics layer
        app.aoiGraphicsLayer = new GraphicsLayer({
            title: "Areas of Interest",
            listMode: "hide"
        });
        
        // Sketch layer
        app.sketchLayer = new GraphicsLayer({
            title: "Drawing Layer",
            listMode: "hide"
        });
        
        app.view.map.addMany([app.aoiGraphicsLayer, app.sketchLayer]);
    }
    
    // Set up hosted layers (your data)
    async function setupHostedLayers() {
        try {
            // Hosted claims layer (complete dataset)
            app.hostedClaimsLayer = new FeatureLayer({
                url: CONFIG.hostedLayers.claims,
                title: "My Hosted Claims (Complete Dataset)",
                visible: true,
                opacity: 0.7,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.hosted
                }
            });
            
            // Change history layer
            app.changeHistoryLayer = new FeatureLayer({
                url: CONFIG.hostedLayers.changeHistory,
                title: "Change History",
                visible: false,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.changeHistory
                }
            });
            
            // AOI feature layer
            app.aoiFeatureLayer = new FeatureLayer({
                url: CONFIG.hostedLayers.aois,
                title: "AOI Features",
                visible: true,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.aoi
                }
            });
            
            app.view.map.addMany([
                app.hostedClaimsLayer,
                app.changeHistoryLayer,
                app.aoiFeatureLayer
            ]);
            
            console.log("Hosted layers added successfully");
            
        } catch (error) {
            console.error("Error setting up hosted layers:", error);
            showMessage("Warning: Some hosted layers failed to load", "warning");
        }
    }
    
    // Set up BLM layers
    async function setupBLMLayers() {
        try {
            // BLM Active Claims (Live)
            app.blmActiveMapLayer = new FeatureLayer({
                url: CONFIG.blmServices.notClosedFeatures,
                title: "BLM Active Claims (Live)",
                visible: false,
                opacity: 0.6,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.blmActive
                }
            });
            
            // BLM Closed Claims (Live)
            app.blmClosedMapLayer = new FeatureLayer({
                url: CONFIG.blmServices.closedFeatures,
                title: "BLM Closed Claims (Live)",
                visible: false,
                opacity: 0.4,
                renderer: {
                    type: "simple",
                    symbol: CONFIG.symbols.blmClosed
                }
            });
            
            app.view.map.addMany([
                app.blmActiveMapLayer,
                app.blmClosedMapLayer
            ]);
            
            console.log("BLM layers added successfully");
            
        } catch (error) {
            console.error("Error setting up BLM layers:", error);
            showMessage("Warning: BLM layers failed to load", "warning");
        }
    }
    
    // Set up widgets
    function setupWidgets() {
        // Search widget
        const searchWidget = new Search({
            view: app.view
        });
        app.view.ui.add(searchWidget, "top-right");
        
        // Layer list widget
        const layerList = new LayerList({
            view: app.view
        });
        const layerListExpand = new Expand({
            view: app.view,
            content: layerList,
            expandIconClass: "esri-icon-layer-list"
        });
        app.view.ui.add(layerListExpand, "top-right");
        
        // Sketch widget for AOI drawing
        app.sketch = new Sketch({
            layer: app.sketchLayer,
            view: app.view,
            creationMode: "update"
        });
        
        console.log("Widgets set up successfully");
    }
    
    // Set up event listeners
    function setupEventListeners() {
        // Change detection button
        const checkChangesBtn = document.getElementById("checkChanges");
        if (checkChangesBtn) {
            checkChangesBtn.addEventListener("click", function(event) {
                event.preventDefault();
                checkForChanges();
            });
        }
        
        // Export buttons
        const exportAOIBtn = document.getElementById("exportAOI");
        if (exportAOIBtn) {
            exportAOIBtn.addEventListener("click", function(event) {
                event.preventDefault();
                exportAOIReport();
            });
        }
        
        // AOI drawing button
        const drawAOIBtn = document.getElementById("drawAOI");
        if (drawAOIBtn) {
            drawAOIBtn.addEventListener("click", function(event) {
                event.preventDefault();
                startAOIDrawing();
            });
        }
        
        // Auto-check frequency change
        const autoCheckSelect = document.getElementById("autoCheckFrequency");
        if (autoCheckSelect) {
            autoCheckSelect.addEventListener("change", function() {
                setupAutoCheck();
            });
        }
        
        console.log("Event listeners set up successfully");
    }
    
    // Initialize change detection
    function initializeChangeDetection() {
        // Set default date (30 days ago)
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() - 30);
        
        const dateInput = document.getElementById("sinceDate");
        if (dateInput) {
            dateInput.value = defaultDate.toISOString().split('T')[0];
        }
        
        // Load last check time
        const lastCheck = localStorage.getItem(CONFIG.storage.lastCheck);
        if (lastCheck) {
            app.changeDetection.lastCheck = new Date(lastCheck);
            updateLastCheckDisplay();
        }
        
        // Check BLM service status
        checkBLMServiceStatus();
        
        console.log("Change detection initialized");
    }
    
    // Check BLM service status
    async function checkBLMServiceStatus() {
        const statusElement = document.getElementById("blmServiceStatus");
        
        try {
            // Test the BLM service
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "?f=json", {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.name && !data.error) {
                    if (statusElement) {
                        statusElement.innerHTML = '🟢 Online';
                        statusElement.className = 'status-online';
                    }
                    console.log("BLM Service Available:", data.name);
                    return { available: true, error: null };
                } else {
                    throw new Error(data.error ? data.error.message : "Invalid service response");
                }
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
        } catch (error) {
            console.error("BLM service check failed:", error);
            if (statusElement) {
                statusElement.innerHTML = '🔴 Offline';
                statusElement.className = 'status-offline';
            }
            return { available: false, error: error.message };
        }
    }
    
    // Main change detection function
    async function checkForChanges() {
        if (app.changeDetection.isRunning) {
            showMessage("Change detection already in progress...", "warning");
            return;
        }
        
        const button = document.getElementById("checkChanges");
        
        try {
            app.changeDetection.isRunning = true;
            
            if (button) {
                button.disabled = true;
                button.textContent = "Checking...";
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
            const changes = await detectChanges(sinceDate);
            
            // Update UI with results
            updateChangeResults(changes);
            
            // Store results
            app.changeDetection.lastResults = changes;
            app.changeDetection.lastCheck = new Date();
            
            // Update last check time
            localStorage.setItem(CONFIG.storage.lastCheck, new Date().toISOString());
            updateLastCheckDisplay();
            
            const totalChanges = changes.new.length + changes.modified.length + changes.deleted.length;
            showMessage(`Change detection completed. Found ${totalChanges} total changes: ${changes.new.length} new, ${changes.modified.length} modified, ${changes.deleted.length} deleted claims.`, "success");
            
        } catch (error) {
            console.error("Change detection error:", error);
            showMessage("Error checking for changes: " + error.message, "error");
        } finally {
            app.changeDetection.isRunning = false;
            
            if (button) {
                button.disabled = false;
                button.textContent = "Check for Changes Now";
            }
        }
    }
    
    // Detect changes by comparing BLM data with hosted data
    async function detectChanges(sinceDate) {
        const changes = {
            new: [],
            modified: [],
            deleted: [],
            summary: {
                totalChecked: 0,
                newCount: 0,
                modifiedCount: 0,
                deletedCount: 0
            }
        };
        
        try {
            // Query BLM for new claims (created since date)
            const newClaims = await queryBLMClaims("new", sinceDate);
            changes.new = newClaims;
            changes.summary.newCount = newClaims.length;
            
            // Query BLM for modified claims (modified since date, but created before)
            const modifiedClaims = await queryBLMClaims("modified", sinceDate);
            changes.modified = modifiedClaims;
            changes.summary.modifiedCount = modifiedClaims.length;
            
            // Check for deleted claims (in our hosted data but not in BLM)
            const deletedClaims = await findDeletedClaims(sinceDate);
            changes.deleted = deletedClaims;
            changes.summary.deletedCount = deletedClaims.length;
            
            changes.summary.totalChecked = changes.summary.newCount + changes.summary.modifiedCount + changes.summary.deletedCount;
            
            console.log("Change detection results:", changes.summary);
            
        } catch (error) {
            console.error("Error in detectChanges:", error);
            throw error;
        }
        
        return changes;
    }
    
    // Query BLM claims based on type
    async function queryBLMClaims(type, sinceDate) {
        const dateStr = sinceDate.toISOString().split('T')[0];
        let whereClause;
        
        if (type === "new") {
            // New claims: created since the date
            whereClause = `Created >= TIMESTAMP '${dateStr} 00:00:00'`;
        } else if (type === "modified") {
            // Modified claims: modified since date but created before
            whereClause = `Modified >= TIMESTAMP '${dateStr} 00:00:00' AND Created < TIMESTAMP '${dateStr} 00:00:00'`;
        } else {
            throw new Error("Invalid query type: " + type);
        }
        
        const query = {
            where: whereClause,
            outFields: ["CSE_NR", "CSE_NAME", "Created", "Modified", "CSE_DISP", "RCRD_ACRS"],
            returnGeometry: false,
            resultRecordCount: 2000
        };
        
        try {
            const response = await fetch(CONFIG.blmServices.notClosedFeatures + "/query", {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    ...query,
                    f: 'json'
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error.message || "Query failed");
            }
            
            console.log(`Found ${data.features.length} ${type} claims`);
            return data.features.map(feature => ({
                caseNumber: feature.attributes.CSE_NR,
                caseName: feature.attributes.CSE_NAME,
                created: new Date(feature.attributes.Created),
                modified: new Date(feature.attributes.Modified),
                status: feature.attributes.CSE_DISP,
                acres: feature.attributes.RCRD_ACRS,
                changeType: type
            }));
            
        } catch (error) {
            console.error(`Error querying ${type} claims:`, error);
            throw error;
        }
    }
    
    // Find deleted claims (placeholder - would need comparison with hosted data)
    async function findDeletedClaims(sinceDate) {
        // This would require comparing our hosted dataset with current BLM data
        // For now, return empty array
        console.log("Deleted claims detection not yet implemented");
        return [];
    }
    
    // Update change results in UI
    function updateChangeResults(changes) {
        // Update statistics
        const newCountElement = document.getElementById("newClaimsCount");
        const modifiedCountElement = document.getElementById("modifiedClaimsCount");
        const deletedCountElement = document.getElementById("deletedClaimsCount");
        
        if (newCountElement) newCountElement.textContent = changes.summary.newCount;
        if (modifiedCountElement) modifiedCountElement.textContent = changes.summary.modifiedCount;
        if (deletedCountElement) deletedCountElement.textContent = changes.summary.deletedCount;
        
        // Update recent changes statistic
        const recentChangesElement = document.getElementById("recentChanges");
        if (recentChangesElement) {
            recentChangesElement.textContent = changes.summary.totalChecked;
        }
        
        console.log("Change results updated in UI");
    }
    
    // Get the since date from input
    function getSinceDate() {
        const dateInput = document.getElementById("sinceDate");
        if (dateInput && dateInput.value) {
            return new Date(dateInput.value);
        } else {
            // Default to 30 days ago
            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() - 30);
            return defaultDate;
        }
    }
    
    // Update last check display
    function updateLastCheckDisplay() {
        const lastCheckElement = document.getElementById("lastCheck");
        if (lastCheckElement && app.changeDetection.lastCheck) {
            lastCheckElement.textContent = app.changeDetection.lastCheck.toLocaleString();
        }
    }
    
    // Export AOI report
    async function exportAOIReport() {
        try {
            showMessage("Generating AOI report...", "info");
            
            if (!app.changeDetection.lastResults) {
                showMessage("No change detection results available. Run change detection first.", "warning");
                return;
            }
            
            // Generate CSV report
            const csvContent = generateChangeReportCSV(app.changeDetection.lastResults);
            
            // Download the file
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `claimwatch_changes_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showMessage("AOI report exported successfully", "success");
            
        } catch (error) {
            console.error("Export error:", error);
            showMessage("Error exporting report: " + error.message, "error");
        }
    }
    
    // Generate CSV content for change report
    function generateChangeReportCSV(changes) {
        let csv = "Change Type,Case Number,Case Name,Created Date,Modified Date,Status,Acres\\n";
        
        // Add new claims
        changes.new.forEach(claim => {
            csv += `New,${claim.caseNumber},"${claim.caseName}",${claim.created.toISOString()},${claim.modified.toISOString()},${claim.status},${claim.acres}\\n`;
        });
        
        // Add modified claims
        changes.modified.forEach(claim => {
            csv += `Modified,${claim.caseNumber},"${claim.caseName}",${claim.created.toISOString()},${claim.modified.toISOString()},${claim.status},${claim.acres}\\n`;
        });
        
        // Add deleted claims
        changes.deleted.forEach(claim => {
            csv += `Deleted,${claim.caseNumber},"${claim.caseName}",${claim.created.toISOString()},${claim.modified.toISOString()},${claim.status},${claim.acres}\\n`;
        });
        
        return csv;
    }
    
    // Start AOI drawing
    function startAOIDrawing() {
        if (app.sketch) {
            app.sketch.create("polygon");
            showMessage("Click on the map to start drawing an Area of Interest", "info");
        }
    }
    
    // Set up auto-check functionality
    function setupAutoCheck() {
        const select = document.getElementById("autoCheckFrequency");
        if (!select) return;
        
        // Clear existing interval
        if (app.autoCheckInterval) {
            clearInterval(app.autoCheckInterval);
            app.autoCheckInterval = null;
        }
        
        const frequency = select.value;
        if (frequency === "manual") {
            return;
        }
        
        // Convert frequency to milliseconds
        let intervalMs;
        switch (frequency) {
            case "hourly":
                intervalMs = 60 * 60 * 1000;
                break;
            case "daily":
                intervalMs = 24 * 60 * 60 * 1000;
                break;
            case "weekly":
                intervalMs = 7 * 24 * 60 * 60 * 1000;
                break;
            default:
                return;
        }
        
        // Set up interval
        app.autoCheckInterval = setInterval(checkForChanges, intervalMs);
        console.log(`Auto-check set up for ${frequency} (${intervalMs}ms)`);
    }
    
    // Update statistics
    async function updateStatistics() {
        try {
            // This would query layers for current statistics
            // For now, just update the display if we have data
            if (app.changeDetection.lastResults) {
                const totalChanges = app.changeDetection.lastResults.summary.totalChecked;
                const recentElement = document.getElementById("recentChanges");
                if (recentElement && recentElement.textContent === "-") {
                    recentElement.textContent = totalChanges;
                }
            }
        } catch (error) {
            console.error("Error updating statistics:", error);
        }
    }
    
    // Show message to user
    function showMessage(message, type = "info") {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // You could implement a toast notification system here
        // For now, just log to console
    }
    
    // Global sign-in function
    window.signIn = function() {
        IdentityManager.getCredential(CONFIG.portal.url).then(function(credential) {
            console.log("Signed in successfully");
            location.reload(); // Reload to update UI
        }).catch(function(error) {
            console.error("Sign in failed:", error);
            showMessage("Sign in failed: " + error.message, "error");
        });
    };
    
    // Initialize the application when DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeApp);
    } else {
        initializeApp();
    }
    
    console.log("ClaimWatch Pro application script loaded");
});

