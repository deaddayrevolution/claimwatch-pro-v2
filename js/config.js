/**
 * ClaimWatch Pro Configuration
 * Complete configuration for BLM integration, portal authentication, and mapping
 */
const CONFIG = {
    // OAuth Configuration
    oauth: {
        clientId: "Sx3uyUO3z8GO54fn", // Replace with your OAuth Client ID from Choraquest portal
        portal: "https://choraquest.maps.arcgis.com"
    },
    
    // Portal settings
    portal: {
        url: "https://choraquest.maps.arcgis.com",
        username: "",
        password: ""
    },
    
    // Your hosted feature layers (Choraquest portal)
    layers: {
        notClosedClaims: {
            url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/MLRS_MINING_CLAIM_DATA_07192025_gdb/FeatureServer/0",
            title: "My Mining Claims - Not Closed (Hosted)",
            id: "hostedNotClosed"
        },
        closedClaims: {
            url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/MLRS_MINING_CLAIM_DATA_07192025_gdb/FeatureServer/1", 
            title: "My Mining Claims - Closed (Hosted)",
            id: "hostedClosed"
        },
        aois: {
            url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/ClaimWatch_AOIs/FeatureServer/0",
            title: "ClaimWatch_AOIs",
            id: "aois"
        },
        changeHistory: {
            url: "https://services7.arcgis.com/RxZ3EmxsmAvCC7ad/arcgis/rest/services/ClaimWatch_Change_History/FeatureServer/0",
            title: "ClaimWatch_Change_History", 
            id: "changeHistory"
        }
    },
    
    // BLM source services (MapServer for display, FeatureServer for queries/changes)
    blmServices: {
        // FeatureServer endpoints for queries and change detection
        notClosedFeatures: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0",
        closedFeatures: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/FeatureServer/0",
        
        // MapServer endpoints for fast visualization
        notClosedMap: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/MapServer",
        closedMap: "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/MapServer",
        
        // Service metadata
        serviceInfo: {
            maxRecordCount: 2000, // BLM service limit
            supportsAdvancedQueries: true,
            supportsPagination: true,
            supportsStatistics: true
        }
    },
    
    // Change detection settings
    changeDetection: {
        frequency: "manual", // Options: "daily", "weekly", "monthly", "manual"
        trackHistory: true,
        checkInterval: 300000, // 5 minutes when app is open
        batchSize: 1000, // Records per batch for pagination
        maxRetries: 3,
        retryDelay: 5000, // 5 seconds
        defaultDateRange: 30 // Days to look back if no last check date
    },
    
    // Map configuration
    map: {
        basemap: "topo-vector",
        center: [-115, 40], // Nevada/Western US - good for mining claims
        zoom: 6,
        extent: {
            xmin: -125,
            ymin: 31,
            xmax: -102,
            ymax: 49,
            spatialReference: { wkid: 4326 }
        }
    },
    
    // Symbology configuration
    symbols: {
        // Your hosted layer symbols
        hostedDefault: {
            type: "simple-fill",
            color: [0, 123, 255, 0.6], // Blue with transparency
            outline: {
                color: [0, 123, 255, 1],
                width: 2
            }
        },
        hostedRecent: {
            type: "simple-fill",
            color: [0, 255, 0, 0.7], // Green for recent
            outline: {
                color: [0, 255, 0, 1],
                width: 2
            }
        },
        hostedRisk: {
            type: "simple-fill",
            color: [255, 0, 0, 0.7], // Red for risk
            outline: {
                color: [255, 0, 0, 1],
                width: 3
            }
        },
        
        // BLM live layer symbols (more transparent to show through)
        blmActive: {
            type: "simple-fill",
            color: [255, 165, 0, 0.3], // Orange, very transparent
            outline: {
                color: [255, 165, 0, 0.8],
                width: 1
            }
        },
        blmClosed: {
            type: "simple-fill",
            color: [128, 128, 128, 0.3], // Gray, very transparent
            outline: {
                color: [128, 128, 128, 0.6],
                width: 1
            }
        },
        
        // AOI symbols
        aoi: {
            type: "simple-fill",
            color: [255, 255, 0, 0.2], // Yellow, transparent
            outline: {
                color: [255, 255, 0, 1],
                width: 3,
                style: "solid"
            }
        },
        aoiSelected: {
            type: "simple-fill",
            color: [255, 255, 0, 0.4],
            outline: {
                color: [255, 255, 0, 1],
                width: 4,
                style: "dash"
            }
        },
        
        // Change history symbols
        changeNew: {
            type: "simple-marker",
            color: [0, 255, 0],
            size: 8,
            outline: {
                color: [255, 255, 255],
                width: 2
            }
        },
        changeModified: {
            type: "simple-marker",
            color: [255, 255, 0],
            size: 8,
            outline: {
                color: [255, 255, 255],
                width: 2
            }
        },
        changeDeleted: {
            type: "simple-marker",
            color: [255, 0, 0],
            size: 8,
            outline: {
                color: [255, 255, 255],
                width: 2
            }
        }
    },
    
    // Risk criteria for payment risk analysis
    riskCriteria: {
        paymentRiskDate: "2024-09-01", // Claims modified before this date are at risk
        largeClaimThreshold: 20.66, // Max legal claim size in acres
        oldClaimThreshold: 365 // Days since last modification
    },
    
    // Field mapping between BLM and your hosted layers
    fieldMapping: {
        claimId: "CSE_NR",
        claimName: "CSE_NAME", 
        state: "ADMIN_STATE",
        county: "ADMIN_CNTY",
        acres: "RCRD_ACRS",
        status: "CSE_DISP",
        modified: "Modified",
        created: "Created",
        longitude: "CASE_LND_LONGITUDE",
        latitude: "CASE_LND_LATITUDE"
    },
    
    // Popup templates configuration
    popupTemplates: {
        claims: {
            title: "{CSE_NAME} ({CSE_NR})",
            content: [{
                type: "fields",
                fieldInfos: [
                    { fieldName: "CSE_NR", label: "Claim ID" },
                    { fieldName: "CSE_NAME", label: "Claim Name" },
                    { fieldName: "ADMIN_STATE", label: "State" },
                    { fieldName: "ADMIN_CNTY", label: "County" },
                    { fieldName: "RCRD_ACRS", label: "Acres", format: { places: 2 } },
                    { fieldName: "CSE_DISP", label: "Status" },
                    { fieldName: "Modified", label: "Last Modified", format: { dateFormat: "short-date" } },
                    { fieldName: "Created", label: "Created", format: { dateFormat: "short-date" } }
                ]
            }]
        },
        aoi: {
            title: "{aoi_name}",
            content: [{
                type: "fields",
                fieldInfos: [
                    { fieldName: "description", label: "Description" },
                    { fieldName: "created_date", label: "Created", format: { dateFormat: "short-date" } },
                    { fieldName: "total_claims", label: "Total Claims" },
                    { fieldName: "recent_changes", label: "Recent Changes" },
                    { fieldName: "last_analysis", label: "Last Analysis", format: { dateFormat: "short-date-short-time" } }
                ]
            }]
        },
        changeHistory: {
            title: "Change: {change_type} - {claim_id}",
            content: [{
                type: "fields",
                fieldInfos: [
                    { fieldName: "change_type", label: "Change Type" },
                    { fieldName: "claim_id", label: "Claim ID" },
                    { fieldName: "claim_name", label: "Claim Name" },
                   { fieldName: "change_date", label: "Change Date", format: { dateFormat: "short-date-short-time" } },
                    { fieldName: "state", label: "State" },
                    { fieldName: "county", label: "County" },
                    { fieldName: "acres", label: "Acres", format: { places: 2 } },
                    { fieldName: "old_status", label: "Old Status" },
                    { fieldName: "new_status", label: "New Status" }
                ]
            }]
        }
    },
    
    // Storage keys for browser local storage
    storage: {
        aois: "claimwatch_aois",
        settings: "claimwatch_settings",
        lastCheck: "claimwatch_last_check",
        userPreferences: "claimwatch_preferences"
    },
    
    // Refresh intervals (milliseconds)
    refresh: {
        statistics: 300000, // 5 minutes
        changeDetection: 3600000, // 1 hour
        serviceStatus: 60000 // 1 minute
    },
    
    // Export settings
    export: {
        formats: ["CSV", "JSON", "Excel"],
        maxRecords: 10000,
        defaultFilename: "ClaimWatch_Export"
    },
    
    // Error handling configuration
    errorHandling: {
        maxRetries: 3,
        retryDelay: 2000,
        showUserErrors: true,
        logErrors: true
    },
    
    // Performance settings
    performance: {
        maxFeaturesForClient: 50000, // Switch to server-side processing above this
        clusteringThreshold: 1000, // Enable clustering above this many features
        simplificationTolerance: 10, // Meters for geometry simplification
        updateThrottle: 1000 // Milliseconds between UI updates
    },
    
    // UI Configuration
    ui: {
        defaultSidebarWidth: 380,
        maxSidebarHeight: "calc(100% - 100px)",
        animationDuration: 300,
        messageTimeout: 3000, // 3 seconds
        loadingTimeout: 30000 // 30 seconds
    },
    
    // Development/Debug settings
    debug: {
        enabled: false, // Set to true for development
        verboseLogging: false,
        showPerformanceMetrics: false,
        simulateSlowNetwork: false
    }
};
