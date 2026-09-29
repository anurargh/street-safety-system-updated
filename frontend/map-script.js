// ==========================================================================
// STREET SAFETY SYSTEM (SSS) — LIVE MAP & WAYFINDING SCRIPT
// ==========================================================================

// Initialize map with default view on municipal grid
const map = L.map('map', {
    zoomControl: false // We'll add zoom control at bottom-right for clean Swiss layout
}).setView([12.3052, 76.6552], 13);

// Position zoom control cleanly at bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Add high-clarity OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> • SSS Public Wayfinding',
    maxZoom: 19
}).addTo(map);

// Telemetry cursor tracking on top command bar
map.on('mousemove', (e) => {
    const coordsEl = document.getElementById('cursorCoordsReadout');
    if (coordsEl && e.latlng) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        coordsEl.textContent = `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
    }
});

let allCrimes = []; // Global variable to store all crimes
let currentMarkerMode = 'severity'; // Global marker mode variable ('severity' | 'hazard')
let currentHazardMarkers = []; // Array of active hazard Leaflet marker objects for fast re-rendering
let currentUser = localStorage.getItem('authUserEmail') || null; // Stores authenticated email or null
let lastProximityLat = null;
let lastProximityLon = null;

// Helper to provide authentication headers with Bearer token if present
function getAuthHeaders(additional = {}) {
    const headers = { ...additional };
    const token = localStorage.getItem('authToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Reusable Hazard Type to Emoji Mapping
const HAZARD_EMOJI_MAP = {
    "Road Accident": "🚗",
    "Pothole": "🕳️",
    "Broken Streetlight": "💡",
    "Poor Lighting": "🌑",
    "Stray Dogs": "🐕",
    "Stray Dog Activity": "🐕",
    "Road Construction": "🚧",
    "Fallen Tree": "🌳",
    "Waterlogging": "🌊",
    "Flooded Road": "🌊",
    "Oil Spill": "🌊",
    "Traffic Signal Failure": "🚦",
    "Signal Malfunction": "🚦",
    "Unsafe Crossing": "🚶",
    "Unsafe Road Crossing": "🚶",
    "Open Manhole": "🕳️",
    "Broken Footpath": "🕳️",
    "General Hazard": "⚠️",
    "Medical Emergency": "🚑",
    "Fire Hazard": "🔥",
    "Pollution": "🌫️",
    "Crime Alert": "🚨",
    "Unknown Hazard": "📍"
};

/**
 * Returns the corresponding emoji for a given hazard type with keyword fallback.
 */
function getHazardEmoji(hazardType) {
    if (!hazardType) return '⚠️';
    if (HAZARD_EMOJI_MAP[hazardType]) {
        return HAZARD_EMOJI_MAP[hazardType];
    }
    const ht = String(hazardType).trim().toLowerCase();

    if (ht.includes('accident') || ht.includes('crash') || ht.includes('collision')) return '🚗';
    if (ht.includes('pothole') || ht.includes('crater')) return '🕳️';
    if (ht.includes('streetlight') || ht.includes('street light')) return '💡';
    if (ht.includes('lighting') || ht.includes('dark')) return '🌑';
    if (ht.includes('dog') || ht.includes('canine')) return '🐕';
    if (ht.includes('construction') || ht.includes('maintenance')) return '🚧';
    if (ht.includes('tree') || ht.includes('branch')) return '🌳';
    if (ht.includes('waterlog') || ht.includes('flood') || ht.includes('spill')) return '🌊';
    if (ht.includes('signal') || ht.includes('traffic light') || ht.includes('malfunction')) return '🚦';
    if (ht.includes('crossing') || ht.includes('pedestrian')) return '🚶';
    if (ht.includes('manhole') || ht.includes('footpath') || ht.includes('drain')) return '🕳️';
    if (ht.includes('medical')) return '🚑';
    if (ht.includes('fire')) return '🔥';
    if (ht.includes('pollution') || ht.includes('smog')) return '🌫️';
    if (ht.includes('crime') || ht.includes('robbery') || ht.includes('theft') || ht.includes('assault') || ht.includes('murder') || ht.includes('rape') || ht.includes('drug')) return '🚨';
    if (ht.includes('unknown')) return '📍';

    return '⚠️';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Reusable helper to construct Swiss-styled popup HTML content
 */
function getMarkerPopupHtml(crime) {
    const hazardName = crime.hazardType || crime.type || 'Hazard';
    const locationText = crime.description || crime.address || crime.location || 'Municipal road point';
    const dateReported = crime.timestamp 
        ? new Date(crime.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
        : (crime.createdAt ? new Date(crime.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Verified Archive');
    
    const sev = Number(crime.severity) || 5;
    let badgeBg = '#fffbeb';
    let badgeColor = '#d97706';
    let badgeLabel = 'MODERATE';
    let badgeBorder = 'rgba(217, 119, 6, 0.3)';

    if (sev >= 8) {
        badgeBg = '#fef2f2';
        badgeColor = '#dc2626';
        badgeLabel = 'CRITICAL DANGER';
        badgeBorder = 'rgba(220, 38, 38, 0.3)';
    } else if (sev >= 6) {
        badgeBg = '#fff7ed';
        badgeColor = '#ea580c';
        badgeLabel = 'HIGH HAZARD';
        badgeBorder = 'rgba(234, 88, 12, 0.3)';
    } else if (sev <= 2) {
        badgeBg = '#f0fdf4';
        badgeColor = '#16a34a';
        badgeLabel = 'LOW RISK';
        badgeBorder = 'rgba(22, 163, 74, 0.3)';
    }

    const isUserReported = crime.isUserReported === true;
    const cleanUser = (currentUser || localStorage.getItem('authUserEmail') || '').trim().toLowerCase();
    const reporterEmail = (crime.reportedBy || '').trim().toLowerCase();
    const isOwnReport = isUserReported && cleanUser && reporterEmail && cleanUser === reporterEmail;

    // Simulated Baseline Data: strictly DO NOT show upvotes, downvotes, or vote controls
    if (!isUserReported) {
        return `
            <div style="padding: 4px 2px; min-width: 220px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 2px; text-transform: uppercase;">${badgeLabel} • Severity ${sev}/10</span>
                    <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #64748b;">RAD: ${crime.hazardRadius || 100}m</span>
                </div>
                <div class="popup-title">${escapeHtml(hazardName)}</div>
                <div style="margin: 4px 0 6px; font-size: 0.7rem; color: #64748b; font-family: var(--font-mono); text-transform: uppercase;">
                    MUNICIPAL SENSOR NETWORK • BASELINE
                </div>
                <div class="popup-location">${escapeHtml(locationText)}</div>
                <div class="popup-footer-time">OBSERVED: ${dateReported}</div>
            </div>
        `;
    }

    // User Report by the Logged-in User (Own Report)
    if (isOwnReport) {
        return `
            <div style="padding: 4px 2px; min-width: 220px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 2px; text-transform: uppercase;">${badgeLabel} • Severity ${sev}/10</span>
                    <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #64748b;">RAD: ${crime.hazardRadius || 100}m</span>
                </div>
                <div class="popup-title">${escapeHtml(hazardName)}</div>
                <div style="margin: 6px 0; padding: 5px 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; font-size: 0.73rem; color: #1e40af; display: flex; align-items: center; justify-content: space-between;">
                    <span>👤 Reported by: <strong>You (${escapeHtml(reporterEmail)})</strong></span>
                    <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #2563eb; font-weight: 700;">YOUR REPORT</span>
                </div>
                <div class="popup-location">${escapeHtml(locationText)}</div>
                <div class="popup-footer-time">REPORTED: ${dateReported}</div>
                <div style="margin-top: 8px; font-size: 0.72rem; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 5px 8px; border-radius: 2px; text-align: center; font-weight: 600;">
                    👤 Your Report • Verification open to peer citizens
                </div>
            </div>
        `;
    }

    // New Data Entered by Another Logged-In User -> SHOW UPVOTES AND DOWNVOTES
    const crimeId = crime._id || crime.id;
    const reporterName = crime.reportedByName || (crime.reportedBy ? crime.reportedBy.split('@')[0] : 'Citizen');
    const upvotes = Number(crime.upvotes) || 0;
    const downvotes = Number(crime.downvotes) || 0;
    const hasUpvoted = cleanUser && crime.upvotedBy && crime.upvotedBy.includes(cleanUser);
    const hasDownvoted = cleanUser && crime.downvotedBy && crime.downvotedBy.includes(cleanUser);

    let voteControls = '';
    if (cleanUser) {
        voteControls = `
            <div style="display: flex; gap: 6px; margin-top: 8px;">
                <button style="flex: 1; padding: 6px 8px; background: ${hasUpvoted ? '#15803d' : '#16a34a'}; color: white; border: none; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer; text-transform: uppercase;" onclick="voteCrime('${crimeId}', 'upvote')" title="Verify hazard accuracy">▲ Verify (${upvotes})</button>
                <button style="flex: 1; padding: 6px 8px; background: #f1f5f9; color: ${hasDownvoted ? '#b91c1c' : '#dc2626'}; border: 1px solid ${hasDownvoted ? '#dc2626' : '#cbd5e1'}; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer; text-transform: uppercase;" onclick="voteCrime('${crimeId}', 'downvote')" title="Dismiss or dispute report">▼ Dismiss (${downvotes})</button>
            </div>
        `;
    } else {
        voteControls = `
            <a href="login.html" class="auth-vote-prompt-pill" style="display: block; text-align: center; margin-top: 6px;">🔒 Sign in to verify or vote</a>
        `;
    }

    return `
        <div style="padding: 4px 2px; min-width: 220px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 2px; text-transform: uppercase;">${badgeLabel} • Severity ${sev}/10</span>
                <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #64748b;">RAD: ${crime.hazardRadius || 100}m</span>
            </div>
            <div class="popup-title">${escapeHtml(hazardName)}</div>
            <div style="margin: 6px 0; padding: 5px 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; font-size: 0.73rem; color: #1e40af; display: flex; align-items: center; justify-content: space-between;">
                <span>👤 Reported by: <strong>${escapeHtml(reporterName)}</strong></span>
                <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #2563eb; font-weight: 700;">CITIZEN REPORT</span>
            </div>
            <div class="popup-location">${escapeHtml(locationText)}</div>
            <div class="popup-metrics-grid">
                <div class="popup-metric-item">
                    <span class="lbl">Upvotes</span>
                    <span class="val" style="color: #16a34a; font-weight: 700;">▲ ${upvotes}</span>
                </div>
                <div class="popup-metric-item">
                    <span class="lbl">Downvotes</span>
                    <span class="val" style="color: #dc2626; font-weight: 700;">▼ ${downvotes}</span>
                </div>
            </div>
            <div class="popup-footer-time">REPORTED: ${dateReported}</div>
            ${voteControls}
        </div>
    `;
}

/**
 * Creates a severity-based colored geometric triangle marker (Mode 1 - Severity View)
 * Standalone shape without any outer rectangle layer
 */
function createSeverityMarker(crime) {
    let markerColor = '#d97706'; // default amber
    const sev = Number(crime.severity);

    if (!isNaN(sev)) {
        if (sev >= 8) markerColor = '#dc2626'; // Red for critical/severe
        else if (sev >= 6) markerColor = '#ea580c'; // Orange for high
        else if (sev >= 3) markerColor = '#d97706'; // Yellow/Amber for moderate
        else markerColor = '#16a34a'; // Green for low
    } else if (crime.severity === 'red') {
        markerColor = '#dc2626';
    } else if (crime.severity === 'yellow') {
        markerColor = '#d97706';
    }

    const customIcon = L.divIcon({
        className: 'triangle-marker',
        html: `<div style="width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 18px solid ${markerColor}; filter: drop-shadow(0 1px 3px rgba(15,23,42,0.45));"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 18]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Creates a raw emoji icon marker without any outer rectangle or box layer (Mode 2 - Hazard View)
 */
function createHazardMarker(crime) {
    const hazardType = crime.hazardType || crime.type || 'Hazard';
    const emoji = getHazardEmoji(hazardType);

    const customIcon = L.divIcon({
        className: 'raw-emoji-marker',
        html: `<div class="emoji-glyph" title="${escapeHtml(hazardType)}">${emoji}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Main marker renderer based on requested mode ("severity" | "hazard")
 */
function renderMarkers(mode = currentMarkerMode) {
    currentMarkerMode = mode;

    // Instantly remove existing hazard markers
    currentHazardMarkers.forEach(m => map.removeLayer(m));
    currentHazardMarkers = [];

    if (!allCrimes || allCrimes.length === 0) return;

    allCrimes.forEach(crime => {
        let marker;
        if (mode === 'hazard') {
            marker = createHazardMarker(crime);
        } else {
            marker = createSeverityMarker(crime);
        }

        marker.addTo(map);
        currentHazardMarkers.push(marker);
    });
}

// Create Leaflet Control widget for "View" Mode (Top Right - Modern Segmented Control)
const markerStyleControl = L.control({ position: 'topright' });

markerStyleControl.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'marker-style-panel');
    div.innerHTML = `
        <div class="marker-style-header">Map View Mode</div>
        <div class="segmented-view-control">
            <label class="segmented-opt ${currentMarkerMode === 'severity' ? 'active' : ''}" id="segOptSeverity" title="Color-coded risk triangles">
                <input type="radio" name="markerStyleRadio" value="severity" ${currentMarkerMode === 'severity' ? 'checked' : ''}>
                <span class="seg-icon">▲</span>
                <span>Severity</span>
            </label>
            <label class="segmented-opt ${currentMarkerMode === 'hazard' ? 'active' : ''}" id="segOptHazard" title="Category emoji glyphs">
                <input type="radio" name="markerStyleRadio" value="hazard" ${currentMarkerMode === 'hazard' ? 'checked' : ''}>
                <span class="seg-icon">⚠️</span>
                <span>Hazard</span>
            </label>
        </div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

markerStyleControl.addTo(map);

// Change event listener for real-time marker mode switching with segmented highlight
document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'markerStyleRadio') {
        const val = e.target.value;
        renderMarkers(val);
        const optSev = document.getElementById('segOptSeverity');
        const optHaz = document.getElementById('segOptHazard');
        if (optSev) optSev.classList.toggle('active', val === 'severity');
        if (optHaz) optHaz.classList.toggle('active', val === 'hazard');
    }
});

// Create Leaflet control for Verify Consensus HUD (Bottom Left)
const crimeDetailsDiv = L.control({ position: 'bottomleft' });
let currentPeerIndex = 0;

crimeDetailsDiv.onAdd = function (map) {
    this._div = L.DomUtil.create('div', 'crime-details-display');
    this._div.innerHTML = '<div class="consensus-panel-header"><span>VERIFY CONSENSUS</span></div><p>Calculating peer community hazard consensus...</p>';
    L.DomEvent.disableClickPropagation(this._div);
    L.DomEvent.disableScrollPropagation(this._div);
    return this._div;
};

crimeDetailsDiv.addTo(map);

// Function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

// Global helper to center and focus on a peer crime from the consensus widget
window.focusPeerCrime = function(lat, lng, crimeId) {
    map.setView([lat, lng], 16);
    // Find marker and open popup
    currentHazardMarkers.forEach(m => {
        const pos = m.getLatLng();
        if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
            m.openPopup();
        }
    });
};

// Global helper to cycle through peer hazard reports in the consensus widget
window.cyclePeerCrime = function(direction) {
    currentPeerIndex += direction;
    const lat = lastProximityLat !== null ? lastProximityLat : map.getCenter().lat;
    const lon = lastProximityLon !== null ? lastProximityLon : map.getCenter().lng;
    checkProximityToCrimes(lat, lon);
};

// Function to update the Verify Consensus component
// STRICT RULE: Don't include simulated data.
// Only when new data (not entered by the logged in user but by another logged in user) is entered, show upvotes and downvotes.
function checkProximityToCrimes(userLat, userLng) {
    lastProximityLat = userLat;
    lastProximityLon = userLng;

    if (!crimeDetailsDiv || !crimeDetailsDiv._div) return;

    const cleanUser = (currentUser || localStorage.getItem('authUserEmail') || '').trim().toLowerCase();

    // 1. If user is NOT logged in: Prompt them to sign in to verify consensus
    if (!cleanUser) {
        crimeDetailsDiv._div.innerHTML = `
            <div class="consensus-panel-header">
                <span>VERIFY CONSENSUS</span>
                <span style="font-size: 0.65rem; color: #d97706; font-weight: 700; background: #fef3c7; border: 1px solid #fde68a; padding: 2px 6px; border-radius: 3px;">AUTH REQUIRED</span>
            </div>
            <p style="font-size: 0.78rem; color: #475569; margin: 6px 0 10px; line-height: 1.45;">
                Community consensus verification activates when citizens sign in to review and vote on hazard alerts reported by other users.
            </p>
            <a href="login.html" class="btn-bar-login" style="display: block; text-align: center; padding: 8px 14px; font-size: 0.78rem; text-decoration: none; border-radius: 6px; background: #0f172a; color: white;">
                Sign In to Verify Hazards →
            </a>
        `;
        return;
    }

    // 2. Filter: ONLY user-reported data, strictly EXCLUDE simulated data!
    // AND strictly EXCLUDE reports by the current logged-in user!
    const peerCrimes = allCrimes.filter(crime => {
        if (!crime.isUserReported) return false; // Strictly omit simulated baseline data
        const reporter = String(crime.reportedBy || '').trim().toLowerCase();
        if (reporter && reporter === cleanUser) {
            return false; // Strictly omit current user's own reports
        }
        return true;
    });

    const ownCrimes = allCrimes.filter(crime => {
        return crime.isUserReported === true && String(crime.reportedBy || '').trim().toLowerCase() === cleanUser;
    });

    // 3. If NO new data entered by another logged-in user exists:
    // DO NOT show upvotes and downvotes!
    if (peerCrimes.length === 0) {
        let ownNote = '';
        if (ownCrimes.length > 0) {
            ownNote = `
                <div style="margin-top: 10px; font-size: 0.74rem; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 6px 10px; border-radius: 6px; line-height: 1.35;">
                    👤 You have submitted <strong>${ownCrimes.length}</strong> active hazard report${ownCrimes.length > 1 ? 's' : ''}. Community verification is open to peer citizens.
                </div>
            `;
        }

        crimeDetailsDiv._div.innerHTML = `
            <div class="consensus-panel-header">
                <span>VERIFY CONSENSUS</span>
                <span style="font-size: 0.65rem; color: #64748b; font-weight: 700; background: #f1f5f9; padding: 2px 6px; border-radius: 3px;">AWAITING PEER DATA</span>
            </div>
            <p style="font-size: 0.78rem; color: #64748b; margin: 4px 0 6px; line-height: 1.4;">
                No peer citizen reports in this area yet.
            </p>
            <div style="font-size: 0.72rem; color: #94a3b8; line-height: 1.4;">
                When another logged-in user reports a hazard, it will appear here for you to verify or dismiss with upvotes and downvotes.
            </div>
            ${ownNote}
        `;
        return;
    }

    // 4. New data entered by another logged-in user DOES exist!
    // Calculate distances to user coordinates
    let nearbyPeerCrimes = peerCrimes.map(crime => {
        const distance = calculateDistance(userLat, userLng, crime.latitude, crime.longitude);
        return {
            ...crime,
            distance: distance
        };
    });

    nearbyPeerCrimes.sort((a, b) => a.distance - b.distance);

    // Keep index within bounds
    if (currentPeerIndex < 0) currentPeerIndex = nearbyPeerCrimes.length - 1;
    if (currentPeerIndex >= nearbyPeerCrimes.length) currentPeerIndex = 0;

    const selectedCrime = nearbyPeerCrimes[currentPeerIndex];
    const selectedCrimeId = selectedCrime._id || selectedCrime.id;
    const upvotes = Number(selectedCrime.upvotes) || 0;
    const downvotes = Number(selectedCrime.downvotes) || 0;
    const reporter = selectedCrime.reportedByName || (selectedCrime.reportedBy ? selectedCrime.reportedBy.split('@')[0] : 'Citizen');
    const hasUpvoted = cleanUser && selectedCrime.upvotedBy && selectedCrime.upvotedBy.includes(cleanUser);
    const hasDownvoted = cleanUser && selectedCrime.downvotedBy && selectedCrime.downvotedBy.includes(cleanUser);

    let statusBadge = '';
    if (hasUpvoted) {
        statusBadge = `<div style="font-size: 0.72rem; color: #166534; background: #dcfce7; border: 1px solid #86efac; padding: 4px 8px; border-radius: 4px; font-weight: 700; margin-bottom: 6px; text-align: center;">✓ You verified this hazard report</div>`;
    } else if (hasDownvoted) {
        statusBadge = `<div style="font-size: 0.72rem; color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; padding: 4px 8px; border-radius: 4px; font-weight: 700; margin-bottom: 6px; text-align: center;">✗ You dismissed this hazard report</div>`;
    }

    let navControls = '';
    if (nearbyPeerCrimes.length > 1) {
        navControls = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.7rem; font-family: var(--font-mono); color: #64748b;">
                <button type="button" onclick="cyclePeerCrime(-1)" style="padding: 3px 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 600;" title="Previous peer report">&larr; Prev</button>
                <span>Report ${currentPeerIndex + 1} of ${nearbyPeerCrimes.length}</span>
                <button type="button" onclick="cyclePeerCrime(1)" style="padding: 3px 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 600;" title="Next peer report">Next &rarr;</button>
            </div>
        `;
    }

    crimeDetailsDiv._div.innerHTML = `
        <div class="consensus-panel-header">
            <span>VERIFY CONSENSUS</span>
            <span style="font-size: 0.65rem; color: #16a34a; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <span class="live-dot" style="width: 6px; height: 6px;"></span> ACTIVE VOTING
            </span>
        </div>
        ${navControls}
        <div style="margin-top: 4px;">
            <div style="font-weight: 800; color: #0f172a; font-size: 0.88rem; display: flex; align-items: center; gap: 7px; letter-spacing: -0.01em;">
                <span>${getHazardEmoji(selectedCrime.type || selectedCrime.hazardType)}</span>
                <span>${escapeHtml(selectedCrime.type || selectedCrime.hazardType)}</span>
            </div>
            <div style="color: #475569; font-size: 0.76rem; margin: 3px 0 5px;">${escapeHtml(selectedCrime.address || selectedCrime.location || 'Local street zone')}</div>
            <div style="font-size: 0.72rem; color: #1e40af; margin-bottom: 3px;">
                Reported by: <strong>${escapeHtml(reporter)}</strong>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #2563eb; margin-bottom: 6px;">
                PROXIMITY: ~${selectedCrime.distance.toFixed(2)} km • Severity ${selectedCrime.severity}/10
            </div>

            <!-- UPVOTES AND DOWNVOTES (Strictly shown for data entered by another logged-in user) -->
            <div style="display: flex; gap: 12px; margin: 6px 0; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 800; background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 10px; border-radius: 6px; justify-content: space-around;">
                <span style="color: #16a34a;">▲ ${upvotes} Upvote${upvotes === 1 ? '' : 's'}</span>
                <span style="color: #dc2626;">▼ ${downvotes} Downvote${downvotes === 1 ? '' : 's'}</span>
            </div>

            ${statusBadge}

            <!-- ACTION BUTTONS: Verify (Upvote) & Dismiss (Downvote) -->
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button type="button" style="flex: 1; padding: 8px 10px; background: ${hasUpvoted ? '#15803d' : '#16a34a'}; color: white; border: none; font-size: 0.74rem; font-weight: 700; border-radius: 5px; cursor: pointer; text-transform: uppercase; transition: all 0.15s ease;" onclick="voteCrime('${selectedCrimeId}', 'upvote')" title="${hasUpvoted ? 'Click to remove upvote' : 'Verify this hazard report'}">
                    ${hasUpvoted ? '✓ Verified' : '▲ Verify'}
                </button>
                <button type="button" style="flex: 1; padding: 8px 10px; background: #f8fafc; color: ${hasDownvoted ? '#b91c1c' : '#dc2626'}; border: 1px solid ${hasDownvoted ? '#dc2626' : '#cbd5e1'}; font-size: 0.74rem; font-weight: 700; border-radius: 5px; cursor: pointer; text-transform: uppercase; transition: all 0.15s ease;" onclick="voteCrime('${selectedCrimeId}', 'downvote')" title="${hasDownvoted ? 'Click to remove dismissal' : 'Dismiss this hazard report'}">
                    ${hasDownvoted ? '✗ Dismissed' : '▼ Dismiss'}
                </button>
            </div>

            <button type="button" onclick="focusPeerCrime(${selectedCrime.latitude}, ${selectedCrime.longitude}, '${selectedCrimeId}')" style="width: 100%; margin-top: 8px; padding: 7px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; font-size: 0.72rem; color: #334155; font-family: var(--font-sans); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: background 0.15s ease;" title="Center map on this hazard">
                <span>🎯</span> <span>Focus Pin on Map</span>
            </button>
        </div>
    `;
}

// Global voting handler for consensus verification
window.voteCrime = async function(crimeId, voteType) {
    currentUser = localStorage.getItem('authUserEmail');
    if (!currentUser) {
        window.location.href = 'login.html?message=' + encodeURIComponent('Please sign in to verify or vote on community hazards');
        return;
    }

    try {
        const response = await fetch(`/api/crimes/${crimeId}/${voteType}`, {
            method: 'POST',
            credentials: 'include',
            headers: getAuthHeaders({
                'Content-Type': 'application/json'
            })
        });

        if (response.status === 401) {
            window.location.href = 'login.html?message=' + encodeURIComponent('Session expired. Please sign in again.');
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            alert(data.message || 'Voting failed');
            return;
        }

        // Update local crime state immediately
        const updatedCrime = data.crime || data;
        const targetId = updatedCrime.id || updatedCrime._id || crimeId;
        const idx = allCrimes.findIndex(c => String(c._id) === String(targetId) || String(c.id) === String(targetId));
        if (idx !== -1) {
            allCrimes[idx] = { ...allCrimes[idx], ...updatedCrime };
        }

        // Re-render markers and update popups
        renderMarkers(currentMarkerMode);

        // Update any open popup immediately
        map.eachLayer(layer => {
            if (layer instanceof L.Marker && layer.getPopup && layer.getPopup()) {
                const latlng = layer.getLatLng();
                if (Math.abs(latlng.lat - updatedCrime.latitude) < 0.0001 && Math.abs(latlng.lng - updatedCrime.longitude) < 0.0001) {
                    layer.setPopupContent(getMarkerPopupHtml(allCrimes[idx] || updatedCrime));
                }
            }
        });

        // Update Verify Consensus panel with latest upvotes/downvotes
        const lat = lastProximityLat !== null ? lastProximityLat : map.getCenter().lat;
        const lon = lastProximityLon !== null ? lastProximityLon : map.getCenter().lng;
        checkProximityToCrimes(lat, lon);
    } catch (error) {
        console.error(`Error ${voteType}ing crime:`, error);
    }
};

function fetchAndDisplayCrimes() {
    fetch('/api/crimes', { credentials: 'include', headers: getAuthHeaders() })
        .then(response => response.json())
        .then(crimes => {
            allCrimes = crimes;
            renderMarkers(currentMarkerMode);

            // Update top bar telemetry
            const countVal = document.getElementById('activeHazardsCountVal');
            const countBlock = document.getElementById('activeHazardsCountBlock');
            if (countVal && countBlock) {
                countVal.textContent = `${crimes.length} ACTIVE`;
                countBlock.style.display = 'flex';
            }

            // Keep Verify Consensus refreshed with latest peer consensus data
            const lat = lastProximityLat !== null ? lastProximityLat : map.getCenter().lat;
            const lon = lastProximityLon !== null ? lastProximityLon : map.getCenter().lng;
            checkProximityToCrimes(lat, lon);
        })
        .catch(error => console.error('Error fetching crimes:', error));
}

// Authentication status manager
async function checkAuthStatus() {
    const storedEmail = localStorage.getItem('authUserEmail');
    if (storedEmail) {
        currentUser = storedEmail;
        updateAuthUI(true, storedEmail);
    }

    try {
        const response = await fetch('/api/me', {
            method: 'GET',
            credentials: 'include',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.email;
            localStorage.setItem('authUserEmail', data.email);
            updateAuthUI(true, data.email);
        } else {
            // Only clear state if server explicitly says unauthorized and no local token was found
            const token = localStorage.getItem('authToken');
            if (!token && response.status === 401) {
                currentUser = null;
                localStorage.removeItem('authUserEmail');
                updateAuthUI(false);
            }
        }
    } catch (err) {
        console.warn('Network issue during auth verification:', err);
        if (storedEmail) {
            currentUser = storedEmail;
            updateAuthUI(true, storedEmail);
        }
    }
}

function updateAuthUI(isLoggedIn, email) {
    const reportBtn = document.getElementById('reportCrimeBtn');
    const authNotice = document.getElementById('authNotice');
    const authLoginLink = document.getElementById('authLoginLink');
    const authUserBadge = document.getElementById('authUserBadge');
    const userEmailSpan = document.getElementById('userEmailSpan');
    const authLogoutBtn = document.getElementById('authLogoutBtn');

    if (isLoggedIn && email) {
        if (reportBtn) {
            reportBtn.disabled = false;
            reportBtn.title = 'Report Hazard';
        }
        if (authNotice) authNotice.style.display = 'none';
        if (authLoginLink) authLoginLink.style.display = 'none';
        if (authUserBadge) {
            authUserBadge.style.display = 'inline-flex';
            const name = localStorage.getItem('authDisplayName');
            if (userEmailSpan) {
                userEmailSpan.textContent = name && name !== email ? `${name} (${email})` : email;
            }
            const avatarInitial = document.getElementById('userAvatarInitial');
            if (avatarInitial) {
                const initialChar = (name || email || 'U')[0].toUpperCase();
                avatarInitial.textContent = initialChar;
            }
        }
        if (authLogoutBtn) authLogoutBtn.style.display = 'inline-flex';
    } else {
        if (reportBtn) {
            reportBtn.disabled = false;
            reportBtn.title = 'Report Hazard (Sign in required)';
        }
        if (authNotice) authNotice.style.display = 'inline-flex';
        if (authLoginLink) authLoginLink.style.display = 'inline-flex';
        if (authUserBadge) authUserBadge.style.display = 'none';
        if (authLogoutBtn) authLogoutBtn.style.display = 'none';
    }

    // Refresh proximity radar if active
    if (lastProximityLat !== null && lastProximityLon !== null) {
        checkProximityToCrimes(lastProximityLat, lastProximityLon);
    }
}

// Wire logout button
const authLogoutBtn = document.getElementById('authLogoutBtn');
if (authLogoutBtn) {
    authLogoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });
        } catch (e) {
            console.error('Logout error:', e);
        }
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUserEmail');
        localStorage.removeItem('authDisplayName');
        localStorage.removeItem('authProvider');
        localStorage.removeItem('authUid');
        currentUser = null;
        updateAuthUI(false);
        fetchAndDisplayCrimes();
    });
}

let userLocationMarker = null;

// Function to handle user location updates
function handleUserLocation(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    
    localStorage.setItem('locationPermissionGranted', 'true');
    localStorage.setItem('lastLat', lat.toString());
    localStorage.setItem('lastLon', lon.toString());

    if (!userLocationMarker) {
        const userIcon = L.divIcon({
            className: 'user-location-marker',
            html: '<div style="background-color: #2563eb; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #2563eb, 0 2px 6px rgba(0,0,0,0.3);"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        userLocationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map);
        userLocationMarker.bindPopup("<b>Your Current Location (GPS)</b>").openPopup();
        map.setView([lat, lon], 13);
    } else {
        userLocationMarker.setLatLng([lat, lon]);
    }

    checkProximityToCrimes(lat, lon);
    fetchAndDisplayCrimes();
}

function handleLocationError(error) {
    console.warn("Geolocation fallback active: ", error);
    localStorage.setItem('locationPermissionGranted', 'false');
    fetchAndDisplayCrimes();
}

const locationPermissionGranted = localStorage.getItem('locationPermissionGranted');

if (navigator.geolocation) {
    if (locationPermissionGranted === 'true') {
        const lastLat = parseFloat(localStorage.getItem('lastLat'));
        const lastLon = parseFloat(localStorage.getItem('lastLon'));
        
        if (!isNaN(lastLat) && !isNaN(lastLon)) {
            handleUserLocation({ coords: { latitude: lastLat, longitude: lastLon } });
            navigator.geolocation.watchPosition(handleUserLocation, handleLocationError);
        } else {
            navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
        }
    } else {
        navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
    }
} else {
    fetchAndDisplayCrimes();
}

// Hazard Report Form & Map Picker Logic
const reportCrimeBtn = document.getElementById('reportCrimeBtn');
const crimeReportForm = document.getElementById('crimeReportForm');
const modalBackdrop = document.getElementById('modalBackdrop');
const crimeForm = document.getElementById('crimeForm');
const cancelCrimeReportBtn = document.getElementById('cancelCrimeReport');
const locationInput = document.getElementById('location');
const addressInput = document.getElementById('address');
const pickReportLocationBtn = document.getElementById('pickReportLocationBtn');

let reportCoords = null; // Stores { lat, lng } for reported hazard
let reportMarker = null; // Draggable Leaflet marker for reporting location

/**
 * Sets or updates the draggable report hazard location pin on the map
 */
function setReportLocation(lat, lon, label) {
    reportCoords = { lat, lng: lon };
    if (locationInput) {
        locationInput.value = label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }

    if (reportMarker) {
        map.removeLayer(reportMarker);
    }

    const reportPinIcon = L.divIcon({
        className: 'report-location-pin',
        html: `<div style="background-color: #dc2626; color: white; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid white; box-shadow: 0 4px 10px rgba(15,23,42,0.4); cursor: move;" title="Drag pin to fine-tune hazard location">⚠️</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    reportMarker = L.marker([lat, lon], { icon: reportPinIcon, draggable: true }).addTo(map);
    reportMarker.bindPopup(`<b>Incident Coordinates Assigned</b><br>Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}<br><small style="color: #64748b;">Drag pin to adjust exact point</small>`).openPopup();

    reportMarker.on('dragend', function (event) {
        const marker = event.target;
        const position = marker.getLatLng();
        setReportLocation(position.lat, position.lng, `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`);
    });
}

function openReportModal() {
    if (!currentUser) {
        currentUser = localStorage.getItem('authUserEmail');
    }

    if (!currentUser) {
        window.location.href = 'login.html?message=' + encodeURIComponent('Please sign in to report a road hazard');
        return;
    }

    if (crimeReportForm) {
        crimeReportForm.classList.remove('picking-banner-mode');
        crimeReportForm.style.display = 'block';
    }
    if (modalBackdrop) modalBackdrop.style.display = 'block';

    const center = map.getCenter();
    if (!reportCoords) {
        setReportLocation(center.lat, center.lng, `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
    }
}

function startPickingReportLocation() {
    mapPickingMode = 'report';
    if (modalBackdrop) modalBackdrop.style.display = 'none';
    if (crimeReportForm) {
        crimeReportForm.classList.add('picking-banner-mode');
        crimeReportForm.style.display = 'block';
    }
}

function finishPickingReportLocation() {
    mapPickingMode = null;
    if (crimeReportForm) {
        crimeReportForm.classList.remove('picking-banner-mode');
        crimeReportForm.style.display = 'block';
    }
    if (modalBackdrop) modalBackdrop.style.display = 'block';
}

function closeReportModal() {
    if (crimeReportForm) {
        crimeReportForm.classList.remove('picking-banner-mode');
        crimeReportForm.style.display = 'none';
    }
    if (modalBackdrop) modalBackdrop.style.display = 'none';
    if (reportMarker) {
        map.removeLayer(reportMarker);
        reportMarker = null;
    }
    reportCoords = null;
    if (mapPickingMode === 'report') mapPickingMode = null;
}

if (reportCrimeBtn) {
    reportCrimeBtn.addEventListener('click', openReportModal);
}

if (pickReportLocationBtn) {
    pickReportLocationBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startPickingReportLocation();
    });
}

const donePickingBtn = document.getElementById('donePickingBtn');
if (donePickingBtn) {
    donePickingBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        finishPickingReportLocation();
    });
}

if (cancelCrimeReportBtn) {
    cancelCrimeReportBtn.addEventListener('click', closeReportModal);
}

const closeReportModalBtn = document.getElementById('closeReportModalBtn');
if (closeReportModalBtn) {
    closeReportModalBtn.addEventListener('click', closeReportModal);
}

if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
        if (mapPickingMode !== 'report') {
            closeReportModal();
        }
    });
}

// Reactive severity rating UI updater
window.updateSeverityUI = function(val) {
    const severityVal = document.getElementById('severityVal');
    if (!severityVal) return;
    const num = Number(val);
    severityVal.textContent = `${num} / 10`;
    severityVal.classList.remove('sev-level-low', 'sev-level-med', 'sev-level-high');
    if (num <= 3) {
        severityVal.classList.add('sev-level-low');
    } else if (num <= 6) {
        severityVal.classList.add('sev-level-med');
    } else {
        severityVal.classList.add('sev-level-high');
    }
};

// Form submit handler for reporting a hazard
if (crimeForm) {
    crimeForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!currentUser) {
            currentUser = localStorage.getItem('authUserEmail');
        }

        if (!currentUser) {
            window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to report a hazard');
            return;
        }

        const typeElement = document.getElementById('crime-type');
        const detailsElement = document.getElementById('crime-details');
        const severityElement = document.getElementById('hazard-severity');

        if (!typeElement || !locationInput) {
            alert("Error: One or more form fields could not be found.");
            return;
        }

        const type = typeElement.value;
        const locationStr = locationInput.value;
        const details = detailsElement ? detailsElement.value : '';
        const address = addressInput ? addressInput.value : '';
        const severity = severityElement ? Number(severityElement.value) : 6;

        let latitude = null;
        let longitude = null;

        if (reportCoords && reportCoords.lat && reportCoords.lng) {
            latitude = reportCoords.lat;
            longitude = reportCoords.lng;
        } else {
            const matches = locationStr.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
            if (matches) {
                latitude = parseFloat(matches[1]);
                longitude = parseFloat(matches[2]);
            }
        }

        if (latitude === null || longitude === null) {
            try {
                const coords = await getCoordinates(`${locationStr}, ${address}`);
                latitude = coords.lat;
                longitude = coords.lon;
            } catch (e) {
                const center = map.getCenter();
                latitude = center.lat;
                longitude = center.lng;
            }
        }

        const submitBtn = document.getElementById('submitCrimeBtn') || crimeForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        }

        try {
            const authName = localStorage.getItem('authDisplayName');
            const authEmail = localStorage.getItem('authUserEmail') || currentUser;
            const reporterName = (authName && authName.trim()) || (authEmail ? authEmail.split('@')[0] : 'Citizen');

            const response = await fetch('/api/crimes', {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders({
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({
                    type,
                    hazardType: type,
                    location: address || locationStr || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                    details,
                    latitude,
                    longitude,
                    address,
                    severity,
                    reportedByName: reporterName
                })
            });

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Report';
            }

            if (response.status === 401) {
                window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to report a hazard');
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to report hazard');
            }

            const result = await response.json();
            console.log('Hazard reported:', result);

            const successMessageDiv = document.getElementById('successMessage');
            if (successMessageDiv) {
                successMessageDiv.textContent = 'Hazard reported and ingested successfully!';
                successMessageDiv.style.display = 'block';
            }

            if (reportMarker) {
                map.removeLayer(reportMarker);
                reportMarker = null;
            }
            reportCoords = null;

            fetchAndDisplayCrimes();

            setTimeout(() => {
                if (successMessageDiv) successMessageDiv.style.display = 'none';
                crimeForm.reset();
                const severityVal = document.getElementById('severityVal');
                if (severityVal) severityVal.textContent = '6';
                closeReportModal();
            }, 1400);

        } catch (error) {
            console.error('Error reporting hazard:', error);
            alert(`An error occurred while reporting the hazard: ${error.message}`);
        }
    });
}

async function getCoordinates(query) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    if (data.length > 0) {
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
        };
    } else {
        throw new Error("Location not found");
    }
}

fetchAndDisplayCrimes();
checkAuthStatus();

// Polling interval so simultaneous user reports from any account appear on map automatically
setInterval(() => {
    fetchAndDisplayCrimes();
}, 5000);

// Update proximity radar as the user moves/pans around the map
map.on('moveend', () => {
    if (lastProximityLat === null && lastProximityLon === null) {
        const center = map.getCenter();
        checkProximityToCrimes(center.lat, center.lng);
    }
});

/* ==========================================================================
   SAFETY-AWARE ROUTING & NAVIGATION FEATURE
   ========================================================================== */

let sourceCoords = null;
let destCoords = null;
let sourceMarker = null;
let destMarker = null;

let mapPickingMode = null; // 'source' or 'destination'

let routeLayers = {
    fastest: [],
    safest: [],
    optimal: []
};

// UI Elements
const sourceInput = document.getElementById('sourceInput');
const destInput = document.getElementById('destInput');
const useMyLocationBtn = document.getElementById('useMyLocationBtn');
const pickSourceBtn = document.getElementById('pickSourceBtn');
const pickDestBtn = document.getElementById('pickDestBtn');
const generateRoutesBtn = document.getElementById('generateRoutesBtn');
const clearRoutesBtn = document.getElementById('clearRoutesBtn');
const routeLoadingSpinner = document.getElementById('routeLoadingSpinner');
const routeCardsContainer = document.getElementById('routeCardsContainer');
const togglePanelBtn = document.getElementById('togglePanelBtn');
const panelContent = document.getElementById('panelContent');

// Toggle Panel Collapse/Expand
if (togglePanelBtn && panelContent) {
    togglePanelBtn.addEventListener('click', () => {
        if (panelContent.style.display === 'none') {
            panelContent.style.display = 'block';
            togglePanelBtn.innerHTML = '&minus;';
        } else {
            panelContent.style.display = 'none';
            togglePanelBtn.innerHTML = '&#43;';
        }
    });
}

// "Use My Location" Button
if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', () => {
        if (userLocationMarker) {
            const latLng = userLocationMarker.getLatLng();
            setSourceLocation(latLng.lat, latLng.lng, "Current GPS Location");
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setSourceLocation(pos.coords.latitude, pos.coords.longitude, "Current GPS Location");
                },
                (err) => alert("Could not determine location: " + err.message)
            );
        } else {
            alert("Geolocation is not supported by your browser.");
        }
    });
}

// Pick Source on Map Button
if (pickSourceBtn) {
    pickSourceBtn.addEventListener('click', () => {
        mapPickingMode = 'source';
    });
}

// Pick Destination on Map Button
if (pickDestBtn) {
    pickDestBtn.addEventListener('click', () => {
        mapPickingMode = 'destination';
    });
}

// Map Click Handler for Pickers
map.on('click', async (e) => {
    if (mapPickingMode === 'report') {
        const { lat, lng } = e.latlng;
        setReportLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        finishPickingReportLocation();
    } else if (mapPickingMode === 'source') {
        const { lat, lng } = e.latlng;
        setSourceLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        mapPickingMode = null;
    } else if (mapPickingMode === 'destination') {
        const { lat, lng } = e.latlng;
        setDestinationLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        mapPickingMode = null;
    }
});

function setSourceLocation(lat, lon, label) {
    sourceCoords = { lat, lon };
    if (sourceInput) sourceInput.value = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    if (sourceMarker) map.removeLayer(sourceMarker);

    const greenIcon = L.divIcon({
        className: 'source-marker',
        html: '<div style="background-color: #16a34a; color: white; border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 0.82rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(15,23,42,0.35);">S</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    sourceMarker = L.marker([lat, lon], { icon: greenIcon }).addTo(map);
    sourceMarker.bindPopup(`<b>Origin Station [Source]</b><br>${label}`).openPopup();
}

function setDestinationLocation(lat, lon, label) {
    destCoords = { lat, lon };
    if (destInput) destInput.value = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    if (destMarker) map.removeLayer(destMarker);

    const redIcon = L.divIcon({
        className: 'dest-marker',
        html: '<div style="background-color: #dc2626; color: white; border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 0.82rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(15,23,42,0.35);">D</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    destMarker = L.marker([lat, lon], { icon: redIcon }).addTo(map);
    destMarker.bindPopup(`<b>Target Destination</b><br>${label}`).openPopup();
}

// Generate Routes Button
if (generateRoutesBtn) {
    generateRoutesBtn.addEventListener('click', async () => {
        try {
            if (!sourceCoords && sourceInput && sourceInput.value.trim() !== '') {
                const coords = await getCoordinates(sourceInput.value.trim());
                setSourceLocation(coords.lat, coords.lon, sourceInput.value.trim());
            }

            if (!destCoords && destInput && destInput.value.trim() !== '') {
                const coords = await getCoordinates(destInput.value.trim());
                setDestinationLocation(coords.lat, coords.lon, destInput.value.trim());
            }

            if (!sourceCoords || !destCoords) {
                alert("Please select or enter both Origin and Destination points.");
                return;
            }

            routeLoadingSpinner.style.display = 'block';

            const response = await fetch('/api/routes', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: sourceCoords,
                    destination: destCoords
                })
            });

            routeLoadingSpinner.style.display = 'none';

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Failed to calculate routes');
            }

            const data = await response.json();
            displayRoutesOnMap(data);

        } catch (err) {
            if (routeLoadingSpinner) routeLoadingSpinner.style.display = 'none';
            console.error('Routing error:', err);
            alert('Error generating routes: ' + err.message);
        }
    });
}

// Clear Routes Button
if (clearRoutesBtn) {
    clearRoutesBtn.addEventListener('click', () => {
        clearAllRoutesFromMap();
        if (sourceMarker) { map.removeLayer(sourceMarker); sourceMarker = null; }
        if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
        sourceCoords = null;
        destCoords = null;
        if (sourceInput) sourceInput.value = '';
        if (destInput) destInput.value = '';
        if (routeCardsContainer) routeCardsContainer.style.display = 'none';
    });
}

function clearAllRoutesFromMap() {
    ['fastest', 'safest', 'optimal'].forEach(type => {
        routeLayers[type].forEach(layer => map.removeLayer(layer));
        routeLayers[type] = [];
    });
}

let currentCalculatedRoutes = null;

function displayRoutesOnMap(data) {
    clearAllRoutesFromMap();
    currentCalculatedRoutes = data;

    const { fastestRoute, safestRoute, optimalRoute } = data;

    const routeTypes = [
        { key: 'fastest', data: fastestRoute, cardId: 'fastestRouteCard', distId: 'fastestDistance', hazId: 'fastestHazard', safId: 'fastestSafety', checkId: 'toggleFastestRoute' },
        { key: 'safest', data: safestRoute, cardId: 'safestRouteCard', distId: 'safestDistance', hazId: 'safestHazard', safId: 'safestSafety', checkId: 'toggleSafestRoute' },
        { key: 'optimal', data: optimalRoute, cardId: 'optimalRouteCard', distId: 'optimalDistance', hazId: 'optimalHazard', safId: 'optimalSafety', checkId: 'toggleOptimalRoute' }
    ];

    const allRouteBounds = [];

    routeTypes.forEach(rt => {
        const routeData = rt.data;
        if (!routeData) return;

        if (routeData.segments && routeData.segments.length > 0) {
            routeData.segments.forEach(seg => {
                const segmentPolyline = L.polyline([seg.start, seg.end], {
                    color: seg.color || routeData.color,
                    weight: rt.key === 'safest' ? 6 : (rt.key === 'optimal' ? 5 : 4),
                    opacity: 0.88
                }).addTo(map);

                segmentPolyline.bindPopup(
                    `<b>${routeData.name}</b><br>Segment Distance: ${seg.distanceKm.toFixed(2)} km<br>Segment Safety: <span style="color:${seg.color}; font-weight:bold;">${seg.safetyLevel}</span> (Hazard Score: ${seg.hazardScore})`
                );

                routeLayers[rt.key].push(segmentPolyline);
            });
        } else if (routeData.coordinates && routeData.coordinates.length > 0) {
            const fallbackPolyline = L.polyline(routeData.coordinates, {
                color: routeData.color,
                weight: 5,
                opacity: 0.85
            }).addTo(map);
            routeLayers[rt.key].push(fallbackPolyline);
        }

        if (routeData.coordinates) {
            routeData.coordinates.forEach(c => allRouteBounds.push(c));
        }

        const distEl = document.getElementById(rt.distId);
        const hazEl = document.getElementById(rt.hazId);
        const safEl = document.getElementById(rt.safId);
        const checkEl = document.getElementById(rt.checkId);

        if (distEl) distEl.textContent = `${routeData.distanceKm} km`;
        if (hazEl) hazEl.textContent = `${routeData.hazardScore}`;
        if (safEl) {
            safEl.textContent = routeData.safetyLevel;
            safEl.style.backgroundColor = routeData.safetyColor || '#64748b';
        }

        if (checkEl) {
            checkEl.checked = true;
            checkEl.onchange = (e) => {
                const show = e.target.checked;
                routeLayers[rt.key].forEach(layer => {
                    if (show) map.addLayer(layer);
                    else map.removeLayer(layer);
                });
            };
        }
    });

    if (routeCardsContainer) routeCardsContainer.style.display = 'flex';

    if (allRouteBounds.length > 0) {
        map.fitBounds(allRouteBounds, { padding: [60, 60] });
    }

    // Attach click listeners to "Start Live Navigation" buttons
    wireStartNavButtons();
}

// Wire up start navigation buttons on route cards
function wireStartNavButtons() {
    document.querySelectorAll('.btn-start-nav').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const routeKey = btn.getAttribute('data-route') || 'safest';
            startLiveNavigation(routeKey);
        };
    });
}

/* ==========================================================================
   REAL-TIME LIVE NAVIGATION CONTROLLER (GOOGLE MAPS EXPERIENCE)
   ========================================================================== */

let liveNavState = {
    isActive: false,
    routeKey: 'safest',
    routeData: null,
    coordinates: [],
    steps: [],
    upcomingHazards: [],
    currentStepIndex: 0,
    currentCoordIndex: 0,
    currentLocation: null,
    currentHeading: 0,
    isSimulating: false, // Default is REAL-TIME GPS TRACKING. Does NOT move on its own!
    isPaused: false,
    simSpeed: 1,
    simTimer: null,
    gpsWatchId: null,
    cameraLocked: true,
    voiceMuted: false,
    startTime: null,
    traveledDistanceMeters: 0,
    hazardsAvoidedCount: 0,
    spokenPrompts: new Set(),
    userMarker: null,
    activePolyline: null,
    traversedPolyline: null,
    hazardMarkerLayers: []
};

// Maneuver Icons Dictionary
const MANEUVER_ICONS = {
    'depart': '⬆️',
    'straight': '⬆️',
    'turn-right': '➡️',
    'turn-left': '⬅️',
    'slight-right': '↗️',
    'slight-left': '↖️',
    'sharp-right': '↪️',
    'sharp-left': '↩️',
    'u-turn': '🔄',
    'roundabout': '🔄',
    'arrive': '🏁'
};

function getManeuverIcon(maneuver, modifier) {
    if (MANEUVER_ICONS[maneuver]) return MANEUVER_ICONS[maneuver];
    if (modifier && modifier.includes('right')) return '➡️';
    if (modifier && modifier.includes('left')) return '⬅️';
    return '⬆️';
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearingAngle(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Text-to-Speech Voice Guidance Prompt
function speakVoiceGuidance(text) {
    if (liveNavState.voiceMuted || !window.speechSynthesis) return;
    try {
        window.speechSynthesis.cancel(); // Stop prior speech immediately
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn('Speech synthesis error:', e);
    }
}

/**
 * Initiates the Live Navigation Mode for the given route (REAL-TIME GPS TRACKING)
 */
function startLiveNavigation(routeKey) {
    if (!currentCalculatedRoutes) {
        alert('Please calculate routes first.');
        return;
    }

    const routeData = currentCalculatedRoutes[routeKey + 'Route'];
    if (!routeData || !routeData.coordinates || routeData.coordinates.length < 2) {
        alert('Selected route does not contain valid path data.');
        return;
    }

    // Stop any existing live navigation
    stopLiveNavigation(false);

    liveNavState.isActive = true;
    liveNavState.routeKey = routeKey;
    liveNavState.routeData = routeData;
    liveNavState.coordinates = routeData.coordinates;
    liveNavState.steps = routeData.steps || [];
    liveNavState.upcomingHazards = routeData.upcomingHazards || [];
    liveNavState.currentStepIndex = 0;
    liveNavState.currentCoordIndex = 0;

    // Use current GPS position if available and near route origin; otherwise start at route origin
    let initialLatLon = routeData.coordinates[0];
    if (userLocationMarker) {
        const userLatLng = userLocationMarker.getLatLng();
        const distToOrigin = calculateDistanceMeters(userLatLng.lat, userLatLng.lng, routeData.coordinates[0][0], routeData.coordinates[0][1]);
        if (distToOrigin <= 600) {
            initialLatLon = [userLatLng.lat, userLatLng.lng];
        }
    }

    liveNavState.currentLocation = initialLatLon;
    liveNavState.currentHeading = calculateBearingAngle(
        routeData.coordinates[0][0], routeData.coordinates[0][1],
        routeData.coordinates[1][0], routeData.coordinates[1][1]
    );

    // Default to Real GPS Tracking (never simulate on its own!)
    liveNavState.isSimulating = false;
    liveNavState.isPaused = false;
    liveNavState.simSpeed = 1;
    liveNavState.cameraLocked = true;
    liveNavState.startTime = Date.now();
    liveNavState.traveledDistanceMeters = 0;
    liveNavState.hazardsAvoidedCount = routeData.hazardScore === 0 ? 3 : 1;
    liveNavState.spokenPrompts = new Set();

    // Hide normal route layers on map
    ['fastest', 'safest', 'optimal'].forEach(k => {
        routeLayers[k].forEach(l => map.removeLayer(l));
    });

    // Collapse wayfinding input panel to free up screen for navigation
    const routeNavPanel = document.getElementById('routeNavigationPanel');
    if (routeNavPanel) routeNavPanel.style.display = 'none';

    // Show Live Navigation HUD
    const hud = document.getElementById('liveNavigationHUD');
    if (hud) hud.style.display = 'block';

    // Ensure Floating bar shows Live GPS mode
    const modeBadge = document.getElementById('liveNavModeLabel');
    if (modeBadge) modeBadge.textContent = 'LIVE GPS ACTIVE';
    const pulseDot = document.getElementById('liveNavPulseDot');
    if (pulseDot) {
        pulseDot.style.background = '#10b981';
        pulseDot.style.boxShadow = '0 0 8px #10b981';
    }
    const simTools = document.getElementById('liveNavSimTools');
    if (simTools) simTools.style.display = 'none';
    const toggleGpsBtn = document.getElementById('liveNavToggleGpsBtn');
    if (toggleGpsBtn) toggleGpsBtn.textContent = '⚡ Demo Run';

    // Configure HUD Badges & Colors
    const routeBadge = document.getElementById('liveNavRouteBadge');
    if (routeBadge) {
        if (routeKey === 'safest') {
            routeBadge.textContent = '🛡️ Safest Path (0 Hazards)';
            routeBadge.style.color = '#34d399';
            routeBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        } else if (routeKey === 'fastest') {
            routeBadge.textContent = '⚡ Fastest Path';
            routeBadge.style.color = '#60a5fa';
            routeBadge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        } else {
            routeBadge.textContent = '⚖️ Optimal Path';
            routeBadge.style.color = '#c084fc';
            routeBadge.style.borderColor = 'rgba(192, 132, 252, 0.4)';
        }
    }

    // Set up high-contrast Navigation Polylines on map
    const navColor = routeKey === 'safest' ? '#10b981' : (routeKey === 'fastest' ? '#2563eb' : '#8b5cf6');

    liveNavState.activePolyline = L.polyline(routeData.coordinates, {
        color: navColor,
        weight: 7,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);

    liveNavState.traversedPolyline = L.polyline([], {
        color: '#64748b',
        weight: 5,
        opacity: 0.45,
        dashArray: '6, 6'
    }).addTo(map);

    // Place hazard warning beacons along the route
    renderNavHazardBeacons();

    // Create high-tech directional user beacon marker (stays at start until user moves!)
    createUserNavMarker(initialLatLon, liveNavState.currentHeading);

    // Center and zoom camera to navigation street view
    map.setView(initialLatLon, 17.5, { animate: true });

    // Initial HUD update
    updateNavDisplay();

    // Voice announcement for start of trip
    const startStep = liveNavState.steps[0];
    const initialPrompt = startStep 
        ? `Starting live navigation along ${routeData.name}. ${startStep.instruction}.`
        : `Starting live navigation along ${routeData.name}. Continue along highlighted street.`;
    speakVoiceGuidance(initialPrompt);

    // Start Real GPS Geolocation Tracking — waits for user to physically move!
    startLiveGpsTracking();
}

/**
 * Starts device GPS tracking with watchPosition to update location only as user moves
 */
function startLiveGpsTracking() {
    if (liveNavState.gpsWatchId) {
        navigator.geolocation.clearWatch(liveNavState.gpsWatchId);
        liveNavState.gpsWatchId = null;
    }

    if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser.');
        const modeBadge = document.getElementById('liveNavModeLabel');
        if (modeBadge) modeBadge.textContent = 'GPS NOT AVAILABLE';
        return;
    }

    liveNavState.gpsWatchId = navigator.geolocation.watchPosition(
        handleLiveGpsPosition,
        handleLiveGpsError,
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
}

/**
 * Handles incoming real GPS position updates from the device
 */
function handleLiveGpsPosition(pos) {
    if (!liveNavState.isActive || liveNavState.isSimulating) return;

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const prevLoc = liveNavState.currentLocation;

    let moveDist = 0;
    if (prevLoc) {
        moveDist = calculateDistanceMeters(prevLoc[0], prevLoc[1], lat, lon);
    }

    // Only process update if user has moved by at least 1.5 meters to prevent jitter
    if (!prevLoc || moveDist >= 1.5) {
        let heading = pos.coords.heading;
        if (heading === null || isNaN(heading)) {
            if (prevLoc && moveDist >= 1.5) {
                heading = calculateBearingAngle(prevLoc[0], prevLoc[1], lat, lon);
            } else {
                heading = liveNavState.currentHeading;
            }
        }

        if (prevLoc && moveDist >= 1.5) {
            liveNavState.traveledDistanceMeters += moveDist;
            const modeBadge = document.getElementById('liveNavModeLabel');
            if (modeBadge) modeBadge.textContent = 'LIVE GPS ACTIVE • MOVING';
        }

        updateLiveNavPosition(lat, lon, heading);
    }
}

function handleLiveGpsError(err) {
    console.warn('Live GPS watch error:', err);
    const modeBadge = document.getElementById('liveNavModeLabel');
    if (modeBadge && !liveNavState.isSimulating) {
        modeBadge.textContent = 'GPS ACQUIRING SIGNAL...';
    }
}

/**
 * Creates or updates the pulsing user beacon marker with directional heading cone
 */
function createUserNavMarker(latLon, heading) {
    if (liveNavState.userMarker) {
        map.removeLayer(liveNavState.userMarker);
    }

    const iconHtml = `
        <div class="nav-beacon-wrapper">
            <div class="nav-beacon-halo"></div>
            <div class="nav-beacon-core"></div>
            <svg class="nav-heading-cone" id="navHeadingConeSvg" style="transform: rotate(${heading || 0}deg);" viewBox="0 0 32 32">
                <polygon points="16,2 22,25 16,19 10,25" fill="#2563eb" stroke="#ffffff" stroke-width="1.8" />
            </svg>
        </div>
    `;

    const navIcon = L.divIcon({
        className: 'nav-user-beacon-icon',
        html: iconHtml,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
    });

    liveNavState.userMarker = L.marker(latLon, { icon: navIcon, zIndexOffset: 2000 }).addTo(map);
}

/**
 * Renders pulsing hazard warning beacons along the active navigation route
 */
function renderNavHazardBeacons() {
    liveNavState.hazardMarkerLayers.forEach(l => map.removeLayer(l));
    liveNavState.hazardMarkerLayers = [];

    if (!liveNavState.upcomingHazards) return;

    liveNavState.upcomingHazards.forEach(h => {
        if (!h.coordinates) return;
        const emoji = getHazardEmoji(h.type);
        const iconHtml = `
            <div style="background: #dc2626; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 15px; border: 2px solid #ffffff; box-shadow: 0 0 12px rgba(220, 38, 38, 0.8);" title="Hazard: ${h.type} (Severity ${h.severity}/10)">
                ${emoji}
            </div>
        `;
        const icon = L.divIcon({
            className: 'nav-hazard-marker',
            html: iconHtml,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker(h.coordinates, { icon, zIndexOffset: 1500 }).addTo(map);
        marker.bindPopup(`<b>⚠️ Hazard on Route: ${h.type}</b><br>Severity: ${h.severity}/10<br>${h.location || ''}`);
        liveNavState.hazardMarkerLayers.push(marker);
    });
}

/**
 * Updates HUD elements, distances, ETA, progress, and upcoming turns
 */
function updateNavDisplay() {
    if (!liveNavState.isActive) return;

    const coords = liveNavState.coordinates;
    const currentLoc = liveNavState.currentLocation;
    const steps = liveNavState.steps;
    const currentStep = steps[liveNavState.currentStepIndex] || steps[steps.length - 1];

    if (!currentLoc) return;

    // Calculate remaining distance along path
    let remainingMeters = 0;
    const currentIdx = Math.min(liveNavState.currentCoordIndex, coords.length - 1);
    for (let i = currentIdx; i < coords.length - 1; i++) {
        remainingMeters += calculateDistanceMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    }

    const totalDistanceMeters = (liveNavState.routeData.distanceKm || 1) * 1000;
    const progressPercent = Math.min(100, Math.max(0, Math.round(((totalDistanceMeters - remainingMeters) / totalDistanceMeters) * 100)));

    // Update Progress Bar
    const progressBar = document.getElementById('liveNavProgressBar');
    if (progressBar) progressBar.style.width = `${progressPercent}%`;

    // Update Bottom Dock Metrics
    const remainingTimeEl = document.getElementById('liveNavRemainingTime');
    const remainingDistEl = document.getElementById('liveNavRemainingDistance');
    const etaTimeEl = document.getElementById('liveNavEtaTime');

    const remainingMinutes = Math.max(1, Math.round((remainingMeters / 1000) / 30 * 60));
    if (remainingTimeEl) remainingTimeEl.textContent = `${remainingMinutes} min`;

    if (remainingDistEl) {
        remainingDistEl.textContent = remainingMeters < 1000
            ? `${Math.round(remainingMeters)} m`
            : `${(remainingMeters / 1000).toFixed(1)} km`;
    }

    if (etaTimeEl) {
        const etaDate = new Date(Date.now() + remainingMinutes * 60000);
        let hours = etaDate.getHours();
        const minutes = etaDate.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        etaTimeEl.textContent = `${hours}:${minutes} ${ampm}`;
    }

    // Distance to next maneuver
    let distToStepMeters = 0;
    if (currentStep && currentStep.location) {
        distToStepMeters = calculateDistanceMeters(
            currentLoc[0], currentLoc[1],
            currentStep.location[0], currentStep.location[1]
        );
    }

    // Update Top Banner
    const distTextEl = document.getElementById('liveNavDistanceText');
    const instructionTextEl = document.getElementById('liveNavInstructionText');
    const maneuverSymbolEl = document.getElementById('liveNavManeuverSymbol');
    const streetBadgeEl = document.getElementById('liveNavStreetBadge');
    const nextTeaserEl = document.getElementById('liveNavNextStepTeaser');
    const nextStepTextEl = document.getElementById('liveNavNextStepText');

    if (distTextEl) {
        if (distToStepMeters <= 20) {
            distTextEl.textContent = 'Now';
        } else if (distToStepMeters < 1000) {
            distTextEl.textContent = `In ${Math.round(distToStepMeters)} m`;
        } else {
            distTextEl.textContent = `In ${(distToStepMeters / 1000).toFixed(1)} km`;
        }
    }

    if (instructionTextEl && currentStep) {
        instructionTextEl.textContent = currentStep.instruction;
    }

    if (maneuverSymbolEl && currentStep) {
        maneuverSymbolEl.textContent = getManeuverIcon(currentStep.maneuver, currentStep.modifier);
    }

    if (streetBadgeEl && currentStep) {
        streetBadgeEl.textContent = currentStep.streetName || (currentStep.modifier ? currentStep.modifier.toUpperCase() : 'WAYFINDING');
    }

    // Preview of step after next
    const nextNextStep = steps[liveNavState.currentStepIndex + 1];
    if (nextTeaserEl && nextStepTextEl) {
        if (nextNextStep && distToStepMeters > 30) {
            nextTeaserEl.style.display = 'block';
            nextStepTextEl.textContent = nextNextStep.instruction;
        } else {
            nextTeaserEl.style.display = 'none';
        }
    }

    // Voice announcement triggers
    handleStepVoiceAnnouncements(distToStepMeters, currentStep);

    // Hazard radar alert check
    checkUpcomingHazardsRadar(currentLoc, remainingMeters);

    // Auto-advance step if user has reached maneuver point
    if (distToStepMeters <= 25 && liveNavState.currentStepIndex < steps.length - 1) {
        liveNavState.currentStepIndex++;
        const newStep = steps[liveNavState.currentStepIndex];
        if (newStep) {
            speakVoiceGuidance(`${newStep.instruction}`);
        }
    }

    // Check Destination Arrival
    if (remainingMeters <= 25 || (currentStep && currentStep.maneuver === 'arrive' && distToStepMeters <= 25)) {
        triggerDestinationArrival();
    }
}

/**
 * Handles proactive voice guidance announcements before turns
 */
function handleStepVoiceAnnouncements(distMeters, step) {
    if (!step) return;
    const stepId = step.stepIndex;

    // 200m warning
    if (distMeters <= 220 && distMeters > 90) {
        const key = `prompt-200-${stepId}`;
        if (!liveNavState.spokenPrompts.has(key)) {
            liveNavState.spokenPrompts.add(key);
            speakVoiceGuidance(`In ${Math.round(distMeters)} meters, ${step.instruction}`);
        }
    }

    // 50m warning
    if (distMeters <= 55 && distMeters > 22) {
        const key = `prompt-50-${stepId}`;
        if (!liveNavState.spokenPrompts.has(key)) {
            liveNavState.spokenPrompts.add(key);
            speakVoiceGuidance(`In 50 meters, ${step.instruction}`);
        }
    }
}

/**
 * Scans active hazards along the route within 250m ahead of the user
 */
function checkUpcomingHazardsRadar(currentLoc, remainingMeters) {
    const hazardBanner = document.getElementById('liveNavHazardBanner');
    const hazardTypeEl = document.getElementById('liveNavHazardType');
    const hazardDetailEl = document.getElementById('liveNavHazardDetail');
    const hazardSevEl = document.getElementById('liveNavHazardSeverityBadge');

    if (!hazardBanner) return;

    let nearestHazard = null;
    let minHazardDist = Infinity;

    if (liveNavState.upcomingHazards) {
        for (const h of liveNavState.upcomingHazards) {
            if (!h.coordinates) continue;
            const dist = calculateDistanceMeters(currentLoc[0], currentLoc[1], h.coordinates[0], h.coordinates[1]);
            if (dist <= 260 && dist < minHazardDist) {
                minHazardDist = dist;
                nearestHazard = h;
            }
        }
    }

    if (nearestHazard) {
        hazardBanner.style.display = 'flex';
        if (hazardTypeEl) hazardTypeEl.textContent = `Hazard Ahead: ${nearestHazard.type}`;
        if (hazardDetailEl) hazardDetailEl.textContent = `Detected in ${Math.round(minHazardDist)}m • Slow down and exercise caution`;
        if (hazardSevEl) hazardSevEl.textContent = `SEV ${nearestHazard.severity}/10`;

        const hazardSpeakKey = `hazard-${nearestHazard.id || nearestHazard.type}`;
        if (!liveNavState.spokenPrompts.has(hazardSpeakKey)) {
            liveNavState.spokenPrompts.add(hazardSpeakKey);
            speakVoiceGuidance(`Caution. ${nearestHazard.type} reported ${Math.round(minHazardDist)} meters ahead.`);
        }
    } else {
        hazardBanner.style.display = 'none';
    }
}

/**
 * Updates live user position, heading, polyline trails, and camera
 */
function updateLiveNavPosition(lat, lon, heading) {
    liveNavState.currentLocation = [lat, lon];
    if (heading !== undefined && heading !== null) {
        liveNavState.currentHeading = heading;
    }

    // Update user marker position and heading cone
    if (liveNavState.userMarker) {
        liveNavState.userMarker.setLatLng([lat, lon]);
        const coneEl = document.getElementById('navHeadingConeSvg');
        if (coneEl) {
            coneEl.style.transform = `rotate(${liveNavState.currentHeading}deg)`;
        }
    }

    // Project progress onto route coordinates
    const coords = liveNavState.coordinates;
    if (coords && coords.length > 0) {
        let bestIdx = liveNavState.currentCoordIndex;
        let minD = Infinity;
        const searchStart = Math.max(0, liveNavState.currentCoordIndex - 2);
        const searchEnd = Math.min(coords.length - 1, liveNavState.currentCoordIndex + 30);
        for (let i = searchStart; i <= searchEnd; i++) {
            const p = coords[i];
            const d = calculateDistanceMeters(lat, lon, p[0], p[1]);
            if (d < minD) {
                minD = d;
                bestIdx = i;
            }
        }
        if (minD < 250) {
            liveNavState.currentCoordIndex = Math.max(liveNavState.currentCoordIndex, bestIdx);
        }

        // Check if destination arrived (< 25m from destination)
        const destCoord = coords[coords.length - 1];
        if (destCoord) {
            const distToDest = calculateDistanceMeters(lat, lon, destCoord[0], destCoord[1]);
            if (distToDest <= 25 && liveNavState.currentCoordIndex >= coords.length - 3) {
                triggerDestinationArrival();
                return;
            }
        }
    }

    // Update polylines (traversed behind user vs active ahead)
    const splitIdx = Math.min(liveNavState.currentCoordIndex, coords.length);
    const passed = coords.slice(0, splitIdx + 1);
    const ahead = coords.slice(splitIdx);

    if (liveNavState.traversedPolyline) liveNavState.traversedPolyline.setLatLngs(passed);
    if (liveNavState.activePolyline) liveNavState.activePolyline.setLatLngs(ahead);

    // Keep camera centered on user if camera is locked
    if (liveNavState.cameraLocked) {
        map.panTo([lat, lon], { animate: true, duration: 0.4 });
    }

    // Update UI HUD
    updateNavDisplay();
}

/**
 * Simulation Loop: Smoothly advances vehicle along route coordinates
 */
function startSimulationLoop() {
    stopSimulationLoop();

    const intervalMs = Math.max(80, Math.round(400 / liveNavState.simSpeed));

    liveNavState.simTimer = setInterval(() => {
        if (!liveNavState.isActive || liveNavState.isPaused || !liveNavState.isSimulating) return;

        const coords = liveNavState.coordinates;
        if (liveNavState.currentCoordIndex >= coords.length - 1) {
            triggerDestinationArrival();
            return;
        }

        liveNavState.currentCoordIndex++;
        const pCurrent = coords[liveNavState.currentCoordIndex];
        const pPrev = coords[liveNavState.currentCoordIndex - 1];

        const segDist = calculateDistanceMeters(pPrev[0], pPrev[1], pCurrent[0], pCurrent[1]);
        liveNavState.traveledDistanceMeters += segDist;

        const newHeading = calculateBearingAngle(pPrev[0], pPrev[1], pCurrent[0], pCurrent[1]);
        updateLiveNavPosition(pCurrent[0], pCurrent[1], newHeading);

    }, intervalMs);
}

function stopSimulationLoop() {
    if (liveNavState.simTimer) {
        clearInterval(liveNavState.simTimer);
        liveNavState.simTimer = null;
    }
}

/**
 * Triggers destination arrival celebration modal & audio
 */
function triggerDestinationArrival() {
    stopSimulationLoop();
    if (liveNavState.gpsWatchId) {
        navigator.geolocation.clearWatch(liveNavState.gpsWatchId);
        liveNavState.gpsWatchId = null;
    }

    speakVoiceGuidance('You have arrived at your destination.');

    const arrivalModal = document.getElementById('liveNavArrivalModal');
    if (arrivalModal) arrivalModal.style.display = 'flex';

    const distEl = document.getElementById('arrivalTotalDist');
    const timeEl = document.getElementById('arrivalTotalTime');
    const hazEl = document.getElementById('arrivalHazardsAvoided');
    const routeTypeEl = document.getElementById('arrivalRouteType');

    const totalDistanceKm = (liveNavState.routeData.distanceKm || 1).toFixed(1);
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - (liveNavState.startTime || Date.now())) / 60000));

    if (distEl) distEl.textContent = `${totalDistanceKm} km`;
    if (timeEl) timeEl.textContent = `${elapsedMinutes} min`;
    if (hazEl) hazEl.textContent = `${liveNavState.hazardsAvoidedCount} avoided`;
    if (routeTypeEl) routeTypeEl.textContent = liveNavState.routeData.name;
}

/**
 * Stops live navigation and returns to normal map overview
 */
function stopLiveNavigation(restoreOverview = true) {
    liveNavState.isActive = false;
    stopSimulationLoop();

    if (liveNavState.gpsWatchId) {
        navigator.geolocation.clearWatch(liveNavState.gpsWatchId);
        liveNavState.gpsWatchId = null;
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }

    // Remove navigation layers
    if (liveNavState.userMarker) {
        map.removeLayer(liveNavState.userMarker);
        liveNavState.userMarker = null;
    }
    if (liveNavState.activePolyline) {
        map.removeLayer(liveNavState.activePolyline);
        liveNavState.activePolyline = null;
    }
    if (liveNavState.traversedPolyline) {
        map.removeLayer(liveNavState.traversedPolyline);
        liveNavState.traversedPolyline = null;
    }
    liveNavState.hazardMarkerLayers.forEach(l => map.removeLayer(l));
    liveNavState.hazardMarkerLayers = [];

    // Hide HUD & Modals
    const hud = document.getElementById('liveNavigationHUD');
    if (hud) hud.style.display = 'none';

    const simTools = document.getElementById('liveNavSimTools');
    if (simTools) simTools.style.display = 'none';

    const stepsModal = document.getElementById('liveNavStepsModal');
    if (stepsModal) stepsModal.style.display = 'none';

    const arrivalModal = document.getElementById('liveNavArrivalModal');
    if (arrivalModal) arrivalModal.style.display = 'none';

    // Restore wayfinding panel & routes
    const routeNavPanel = document.getElementById('routeNavigationPanel');
    if (routeNavPanel) routeNavPanel.style.display = 'block';

    if (restoreOverview && currentCalculatedRoutes) {
        displayRoutesOnMap(currentCalculatedRoutes);
    }
}

// Map user interaction: unlock camera when user pans map
map.on('dragstart', () => {
    if (liveNavState.isActive) {
        liveNavState.cameraLocked = false;
        const recenterBtn = document.getElementById('liveNavRecenterBtn');
        if (recenterBtn) {
            recenterBtn.style.background = '#2563eb';
            recenterBtn.style.boxShadow = '0 0 16px rgba(37, 99, 235, 0.7)';
        }
    }
});

// Setup Live Navigation HUD Event Listeners
function setupLiveNavControls() {
    // Exit navigation button
    const exitBtn = document.getElementById('liveNavExitBtn');
    if (exitBtn) {
        exitBtn.onclick = () => stopLiveNavigation(true);
    }

    const endTripBtn = document.getElementById('liveNavEndTripBtn');
    if (endTripBtn) {
        endTripBtn.onclick = () => stopLiveNavigation(true);
    }

    // Voice toggle button
    const voiceBtn = document.getElementById('liveNavVoiceToggleBtn');
    const voiceIcon = document.getElementById('liveNavVoiceIcon');
    if (voiceBtn) {
        voiceBtn.onclick = () => {
            liveNavState.voiceMuted = !liveNavState.voiceMuted;
            if (voiceBtn) voiceBtn.classList.toggle('voice-muted', liveNavState.voiceMuted);
            if (voiceIcon) voiceIcon.textContent = liveNavState.voiceMuted ? '🔇' : '🔊';
            if (liveNavState.voiceMuted && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            } else {
                speakVoiceGuidance('Voice guidance enabled.');
            }
        };
    }

    // Steps drawer toggle button
    const stepsDrawerBtn = document.getElementById('liveNavStepsDrawerBtn');
    const stepsModal = document.getElementById('liveNavStepsModal');
    const closeStepsModalBtn = document.getElementById('closeStepsModalBtn');

    if (stepsDrawerBtn && stepsModal) {
        stepsDrawerBtn.onclick = () => {
            if (stepsModal.style.display === 'none' || stepsModal.style.display === '') {
                populateStepsItinerary();
                stepsModal.style.display = 'flex';
            } else {
                stepsModal.style.display = 'none';
            }
        };
    }

    if (closeStepsModalBtn && stepsModal) {
        closeStepsModalBtn.onclick = () => {
            stepsModal.style.display = 'none';
        };
    }

    // Re-center button
    const recenterBtn = document.getElementById('liveNavRecenterBtn');
    if (recenterBtn) {
        recenterBtn.onclick = () => {
            liveNavState.cameraLocked = true;
            recenterBtn.style.background = '#0f172a';
            recenterBtn.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.45)';
            if (liveNavState.currentLocation) {
                map.setView(liveNavState.currentLocation, 17.5, { animate: true });
            }
        };
    }

    // Simulation Play/Pause button
    const playPauseBtn = document.getElementById('liveNavPlayPauseBtn');
    if (playPauseBtn) {
        playPauseBtn.onclick = () => {
            liveNavState.isPaused = !liveNavState.isPaused;
            playPauseBtn.textContent = liveNavState.isPaused ? '▶️ Resume' : '⏸️ Pause';
        };
    }

    // Simulation Speed selector
    document.querySelectorAll('.btn-speed-opt').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.btn-speed-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const speed = parseInt(btn.getAttribute('data-speed'), 10) || 1;
            liveNavState.simSpeed = speed;
            if (liveNavState.isSimulating) {
                startSimulationLoop(); // Restart with updated speed
            }
        };
    });

    // Step Forward button (jump to next turn maneuver)
    const stepForwardBtn = document.getElementById('liveNavStepForwardBtn');
    if (stepForwardBtn) {
        stepForwardBtn.onclick = () => {
            const steps = liveNavState.steps;
            if (liveNavState.currentStepIndex < steps.length - 1) {
                liveNavState.currentStepIndex++;
                const targetStep = steps[liveNavState.currentStepIndex];
                if (targetStep && targetStep.coordIndex !== undefined) {
                    liveNavState.currentCoordIndex = targetStep.coordIndex;
                    const p = liveNavState.coordinates[liveNavState.currentCoordIndex];
                    updateLiveNavPosition(p[0], p[1]);
                }
            } else {
                triggerDestinationArrival();
            }
        };
    }

    // Switch between Live GPS Tracking (Default) and Demo Simulation
    const toggleGpsBtn = document.getElementById('liveNavToggleGpsBtn');
    const modeBadge = document.getElementById('liveNavModeLabel');
    const pulseDot = document.getElementById('liveNavPulseDot');
    const simTools = document.getElementById('liveNavSimTools');

    if (toggleGpsBtn) {
        toggleGpsBtn.onclick = () => {
            if (liveNavState.isSimulating) {
                // Return to Live GPS Tracking
                liveNavState.isSimulating = false;
                stopSimulationLoop();

                if (simTools) simTools.style.display = 'none';
                toggleGpsBtn.textContent = '⚡ Demo Run';

                if (modeBadge) {
                    modeBadge.textContent = 'LIVE GPS ACTIVE • WAITING FOR MOVEMENT';
                    modeBadge.style.color = '#34d399';
                }
                if (pulseDot) {
                    pulseDot.style.background = '#10b981';
                    pulseDot.style.boxShadow = '0 0 8px #10b981';
                }

                startLiveGpsTracking();
                speakVoiceGuidance('Live GPS tracking active. Move along the highlighted path.');
            } else {
                // User explicitly selected Demo Simulation Run
                liveNavState.isSimulating = true;
                if (liveNavState.gpsWatchId) {
                    navigator.geolocation.clearWatch(liveNavState.gpsWatchId);
                    liveNavState.gpsWatchId = null;
                }

                if (simTools) simTools.style.display = 'flex';
                toggleGpsBtn.textContent = '📡 Exit Demo (Use GPS)';

                if (modeBadge) {
                    modeBadge.textContent = 'DEMO RUN ACTIVE';
                    modeBadge.style.color = '#38bdf8';
                }
                if (pulseDot) {
                    pulseDot.style.background = '#38bdf8';
                    pulseDot.style.boxShadow = '0 0 8px #38bdf8';
                }

                speakVoiceGuidance('Starting demonstration simulation run.');
                startSimulationLoop();
            }
        };
    }

    // Finish arrival modal button
    const finishArrivalBtn = document.getElementById('finishArrivalBtn');
    if (finishArrivalBtn) {
        finishArrivalBtn.onclick = () => stopLiveNavigation(true);
    }
}

/**
 * Populates the turn-by-turn itinerary drawer with maneuvers, street names, and hazards
 */
function populateStepsItinerary() {
    const listEl = document.getElementById('liveNavStepsList');
    const routeNameEl = document.getElementById('stepsModalRouteName');
    if (!listEl) return;

    if (routeNameEl && liveNavState.routeData) {
        routeNameEl.textContent = `${liveNavState.routeData.name} • ${liveNavState.routeData.distanceKm} km`;
    }

    listEl.innerHTML = '';

    const steps = liveNavState.steps;
    if (!steps || steps.length === 0) {
        listEl.innerHTML = '<div style="color: #94a3b8; padding: 16px; text-align: center;">No steps available.</div>';
        return;
    }

    steps.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = 'nav-step-item';
        if (idx === liveNavState.currentStepIndex) item.classList.add('step-active');
        if (idx < liveNavState.currentStepIndex) item.classList.add('step-completed');

        const icon = getManeuverIcon(step.maneuver, step.modifier);
        const distStr = step.distanceMeters > 0 ? `${step.distanceMeters} m` : '';

        let hazardTagHtml = '';
        if (step.hazardAlert) {
            hazardTagHtml = `<span class="step-hazard-tag">⚠️ ${step.hazardAlert.type} (Sev ${step.hazardAlert.severity}/10)</span>`;
        }

        item.innerHTML = `
            <div class="step-icon-badge">${icon}</div>
            <div class="step-content-col">
                <div class="step-instruction-line">${step.instruction}</div>
                <div class="step-sub-line">${distStr} ${step.streetName ? '• ' + step.streetName : ''}</div>
                ${hazardTagHtml}
            </div>
        `;

        item.onclick = () => {
            if (step.location) {
                map.setView(step.location, 18, { animate: true });
                liveNavState.cameraLocked = false;
                const modal = document.getElementById('liveNavStepsModal');
                if (modal) modal.style.display = 'none';
            }
        };

        listEl.appendChild(item);
    });
}

// Initialize live navigation event controls on load
setupLiveNavControls();

// Handle URL action parameters (e.g. ?action=report)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('action') === 'report') {
    setTimeout(() => {
        openReportModal();
    }, 400);
}

