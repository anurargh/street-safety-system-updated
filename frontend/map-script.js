// Initialize map with default view on Mysuru, Karnataka, India
const map = L.map('map').setView([12.3052, 76.6552], 13);

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let allCrimes = []; // Global variable to store all crimes
let currentMarkerMode = 'severity'; // Global marker mode variable ('severity' | 'hazard')
let currentHazardMarkers = []; // Array of active hazard Leaflet marker objects for fast re-rendering

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

/**
 * Reusable helper to construct popup HTML content
 */
function getMarkerPopupHtml(crime) {
    const hazardName = crime.hazardType || crime.type || 'Hazard';
    const locationText = crime.description || crime.address || crime.location || '';
    const verCount = crime.verificationCount !== undefined ? crime.verificationCount : (crime.upvotes || 0);
    const dateReported = crime.timestamp 
        ? new Date(crime.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) 
        : (crime.createdAt ? new Date(crime.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A');

    return `<b>${hazardName}</b> (Severity: ${crime.severity}/10)<br>` +
           `<i>${locationText}</i><br>` +
           `Status: <b>${crime.status || 'verified'}</b> | Radius: ${crime.hazardRadius || 100}m<br>` +
           `Verifications: ${verCount}<br>` +
           `<small style="color: #666;">Date Reported: ${dateReported}</small>`;
}

/**
 * Creates a severity-based colored triangle marker (Mode 1 - Severity View)
 */
function createSeverityMarker(crime) {
    let markerColor = '#fbbc04'; // default yellow
    const sev = Number(crime.severity);

    if (!isNaN(sev)) {
        if (sev >= 8) markerColor = '#dc3545'; // Red for critical/severe
        else if (sev >= 5) markerColor = '#fd7e14'; // Orange for high
        else if (sev >= 3) markerColor = '#fbbc04'; // Yellow for moderate
        else markerColor = '#28a745'; // Green for low
    } else if (crime.severity === 'red') {
        markerColor = '#dc3545';
    } else if (crime.severity === 'yellow') {
        markerColor = '#fbbc04';
    }

    const customIcon = L.divIcon({
        className: 'custom-div-icon triangle',
        html: `<div style="width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 18px solid ${markerColor}; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 18]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Creates a hazard-type emoji marker (Mode 2 - Hazard View)
 */
function createHazardMarker(crime) {
    const hazardType = crime.hazardType || crime.type || 'Hazard';
    const emoji = getHazardEmoji(hazardType);

    const customIcon = L.divIcon({
        className: 'custom-div-icon emoji-marker',
        html: `<div style="font-size: 20px; line-height: 24px; text-align: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); cursor: pointer;" title="${hazardType}">${emoji}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Main marker renderer based on requested mode ("severity" | "hazard")
 * Designed for easy future extension (e.g. "heatmap", "cluster")
 */
function renderMarkers(mode = currentMarkerMode) {
    currentMarkerMode = mode;

    // Instantly remove existing hazard markers without fetching data again
    currentHazardMarkers.forEach(m => map.removeLayer(m));
    currentHazardMarkers = [];

    if (!allCrimes || allCrimes.length === 0) return;

    allCrimes.forEach(crime => {
        let marker;
        if (mode === 'hazard') {
            marker = createHazardMarker(crime);
        } else {
            // Default: 'severity' mode
            marker = createSeverityMarker(crime);
        }

        marker.addTo(map);
        currentHazardMarkers.push(marker);
    });
}

// Create Leaflet Control widget for "Marker Style"
const markerStyleControl = L.control({ position: 'topright' });

markerStyleControl.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'marker-style-panel leaflet-bar');
    div.innerHTML = `
        <div class="marker-style-header">Marker Style</div>
        <div class="marker-style-options">
            <label class="marker-style-option">
                <input type="radio" name="markerStyleRadio" value="severity" ${currentMarkerMode === 'severity' ? 'checked' : ''}>
                <span>Severity View</span>
            </label>
            <label class="marker-style-option">
                <input type="radio" name="markerStyleRadio" value="hazard" ${currentMarkerMode === 'hazard' ? 'checked' : ''}>
                <span>Hazard View</span>
            </label>
        </div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

markerStyleControl.addTo(map);

// Change event listener for real-time marker mode switching
document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'markerStyleRadio') {
        renderMarkers(e.target.value);
    }
});

// Create a div for crime details display
const crimeDetailsDiv = L.control({position: 'topleft'});

crimeDetailsDiv.onAdd = function (map) {
    this._div = L.DomUtil.create('div', 'crime-details-display');
    this._div.innerHTML = '<h4>Nearby Crime Details</h4><p>Move closer to a crime to see details.</p>';
    return this._div;
};

crimeDetailsDiv.addTo(map);

// Style for the crime details display (you might want to move this to map-style.css)
const style = document.createElement('style');
style.innerHTML = `
    .crime-details-display {
        background: white;
        padding: 10px;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(0,0,0,0.6);
        max-width: 250px;
        font-family: Arial, sans-serif;
        color: #333;
    }
    .crime-details-display h4 {
        margin-top: 0;
        color: #d32f2f;
    }
    .crime-details-display p {
        margin-bottom: 5px;
        font-size: 0.9em;
    }
    .vote-buttons button {
        margin-right: 5px;
        padding: 5px 10px;
        cursor: pointer;
    }
`;
document.head.appendChild(style);

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
    return distance; // Distance in kilometers
}

// Function to check if user is near any crime locations
function checkProximityToCrimes(userLat, userLng) {
    let nearbyCrimes = [];
    allCrimes.forEach(crime => {
        const distance = calculateDistance(userLat, userLng, crime.latitude, crime.longitude);
        nearbyCrimes.push({
            ...crime,
            distance: distance
        });
    });

    if (nearbyCrimes.length === 0) {
        crimeDetailsDiv._div.innerHTML = '<h4>Nearby Crime Details</h4><p>No crimes reported yet.</p>';
        return;
    }

    // Sort crimes: first by distance (ascending), then by upvotes (descending)
    nearbyCrimes.sort((a, b) => {
        if (a.distance !== b.distance) {
            return a.distance - b.distance; // Sort by distance first
        } else {
            return b.upvotes - a.upvotes; // If distances are equal, sort by upvotes (descending)
        }
    });

    const selectedCrime = nearbyCrimes[0]; // Get the single most relevant crime

    let detailsHtml = '<h4>Nearby Crime Details</h4>';
    detailsHtml += `
        <p>
            <strong>Type:</strong> ${selectedCrime.type}<br>
            <strong>Location:</strong> ${selectedCrime.address || selectedCrime.location}<br>
            <strong>Distance:</strong> ~${selectedCrime.distance.toFixed(2)} km<br>
            <strong>Details:</strong> ${selectedCrime.details}<br>
            <span id="upvotes-${selectedCrime._id}">Upvotes: ${selectedCrime.upvotes}</span> | <span id="downvotes-${selectedCrime._id}">Downvotes: ${selectedCrime.downvotes}</span><br>
            <div class="vote-buttons">
                <button onclick="voteCrime('${selectedCrime._id}', 'upvote')">Upvote</button>
                <button onclick="voteCrime('${selectedCrime._id}', 'downvote')">Downvote</button>
            </div>
        </p>
    `;
    crimeDetailsDiv._div.innerHTML = detailsHtml;
    // alert('Nearby crime information updated!'); // Removed this line
}

async function voteCrime(crimeId, voteType) {
    try {
        const userEmail = localStorage.getItem('userEmail'); // Get user email from localStorage
        if (!userEmail) {
            alert('You must be logged in to vote.');
            return;
        }

        const response = await fetch(`/api/crimes/${crimeId}/${voteType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userEmail }) // Send user email in the request body
        });
        const updatedCrime = await response.json();
        if (response.ok) {
            // Update the displayed vote count by checking for nested crime object
            const crimeData = updatedCrime.crime || updatedCrime;
            document.getElementById(`upvotes-${crimeId}`).innerText = `Upvotes: ${crimeData.upvotes}`;
            document.getElementById(`downvotes-${crimeId}`).innerText = `Downvotes: ${crimeData.downvotes}`;
            // Optionally, re-fetch and re-display crimes to re-sort
            fetchAndDisplayCrimes();
        } else {
            console.error(`Error ${voteType}ing crime:`, updatedCrime.message);
            alert(`Failed to ${voteType} crime: ` + updatedCrime.message);
        }
    } catch (error) {
        console.error(`Error ${voteType}ing crime:`, error);
        alert(`An error occurred while ${voteType}ing crime.`);
    }
}

function fetchAndDisplayCrimes() {
    fetch('/api/crimes')
        .then(response => response.json())
        .then(crimes => {
            allCrimes = crimes; // Store crimes globally in memory
            renderMarkers(currentMarkerMode); // Render markers using active visualization mode
        })
        .catch(error => console.error('Error fetching crimes:', error));
}

let userLocationMarker = null; // Global variable to store the user's marker

// Function to handle user location updates
function handleUserLocation(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    
    // Store the location permission in localStorage
    localStorage.setItem('locationPermissionGranted', 'true');
    localStorage.setItem('lastLat', lat.toString());
    localStorage.setItem('lastLon', lon.toString());

    if (!userLocationMarker) {
        // Create a distinct custom icon for the user's location
        const userIcon = L.divIcon({
            className: 'user-location-marker',
            html: '<div style="background-color: #007bff; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        // Create the marker with the custom icon
        userLocationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map);
        userLocationMarker.bindPopup("<b>Your Current Location</b>").openPopup();
        map.setView([lat, lon], 13); // Set map view only on initial location
    } else {
        // Update marker position if it already exists
        userLocationMarker.setLatLng([lat, lon]);
        // Optionally, re-center the map on the user's new position if they move significantly
        map.panTo([lat, lon]);
    }

    // Check proximity to crimes with the updated location
    checkProximityToCrimes(lat, lon);

    // Fetch and display crimes
    fetchAndDisplayCrimes();
}

// Function to handle geolocation errors
function handleLocationError(error) {
    console.error("Error getting geolocation: ", error);
    localStorage.setItem('locationPermissionGranted', 'false');
    alert("Could not retrieve your location. Displaying default map.");
    const defaultMarker = L.marker([40.7128, -74.0060]).addTo(map);
    defaultMarker.bindPopup("<b>Default Location</b><br>Could not retrieve your location.");
    // Fetch and display crimes even if geolocation fails, but without proximity check
    fetchAndDisplayCrimes();
}

// Check if we've already asked for permission
const locationPermissionGranted = localStorage.getItem('locationPermissionGranted');

if (navigator.geolocation) {
    if (locationPermissionGranted === 'true') {
        // If permission was previously granted, use the stored coordinates initially
        const lastLat = parseFloat(localStorage.getItem('lastLat'));
        const lastLon = parseFloat(localStorage.getItem('lastLon'));
        
        if (!isNaN(lastLat) && !isNaN(lastLon)) {
            // Create a position object with the stored coordinates
            const storedPosition = {
                coords: {
                    latitude: lastLat,
                    longitude: lastLon
                }
            };
            
            // Use the stored position immediately
            handleUserLocation(storedPosition);
            
            // Then start watching position for updates (without prompting again)
            navigator.geolocation.watchPosition(handleUserLocation, handleLocationError);
        } else {
            // If stored coordinates are invalid, request once
            navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
        }
    } else {
        // First time asking for permission or previously denied
        navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
    }
} else {
    alert("Geolocation is not supported by your browser. Displaying default map.");
    const defaultMarker = L.marker([40.7128, -74.0060]).addTo(map);
    defaultMarker.bindPopup("<b>Default Location</b><br>Geolocation not supported.");
    fetchAndDisplayCrimes();
}

// Hazard Report Form & Map Picker Logic
const reportCrimeBtn = document.getElementById('reportCrimeBtn');
const crimeReportForm = document.getElementById('crimeReportForm');
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
        html: `<div style="background-color: #dc3545; color: white; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 2px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.4); cursor: move;" title="Drag pin to fine-tune hazard location">⚠️</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });

    reportMarker = L.marker([lat, lon], { icon: reportPinIcon, draggable: true }).addTo(map);
    reportMarker.bindPopup(`<b>Hazard Location Picked</b><br>Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}<br><small style="color: #666;">Drag pin to adjust exact spot</small>`).openPopup();

    reportMarker.on('dragend', function (event) {
        const markerPos = event.target.getLatLng();
        reportCoords = { lat: markerPos.lat, lng: markerPos.lng };
        if (locationInput) {
            locationInput.value = `${markerPos.lat.toFixed(5)}, ${markerPos.lng.toFixed(5)}`;
        }
        reportMarker.getPopup().setContent(`<b>Hazard Location Picked</b><br>Lat: ${markerPos.lat.toFixed(5)}, Lon: ${markerPos.lng.toFixed(5)}<br><small style="color: #666;">Drag pin to adjust exact spot</small>`);
    });
}

if (reportCrimeBtn) {
    reportCrimeBtn.addEventListener('click', () => {
        crimeReportForm.style.display = 'block';
        mapPickingMode = 'report';

        // Default pin position to map center if not yet set
        const center = map.getCenter();
        setReportLocation(center.lat, center.lng, `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
    });
}

if (pickReportLocationBtn) {
    pickReportLocationBtn.addEventListener('click', () => {
        mapPickingMode = 'report';
        alert("Click anywhere on the map to place or move the hazard marker!");
    });
}

if (cancelCrimeReportBtn) {
    cancelCrimeReportBtn.addEventListener('click', () => {
        crimeReportForm.style.display = 'none';
        if (reportMarker) {
            map.removeLayer(reportMarker);
            reportMarker = null;
        }
        reportCoords = null;
        if (mapPickingMode === 'report') mapPickingMode = null;
    });
}

// Form submit handler for reporting a hazard
if (crimeForm) {
    crimeForm.addEventListener('submit', async (event) => {
        event.preventDefault();

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

        try {
            const response = await fetch('/api/crimes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type,
                    hazardType: type,
                    location: address || locationStr || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                    details,
                    latitude,
                    longitude,
                    address,
                    severity
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to report hazard');
            }

            const result = await response.json();
            console.log('Hazard reported:', result);

            const successMessageDiv = document.getElementById('successMessage');
            if (successMessageDiv) {
                successMessageDiv.textContent = 'Hazard reported successfully!';
                successMessageDiv.style.display = 'block';
            }

            // Remove temporary placement marker
            if (reportMarker) {
                map.removeLayer(reportMarker);
                reportMarker = null;
            }
            reportCoords = null;

            // Instantly refresh crimes list and re-render active markers
            fetchAndDisplayCrimes();

            setTimeout(() => {
                if (successMessageDiv) successMessageDiv.style.display = 'none';
                crimeForm.reset();
                const severityVal = document.getElementById('severityVal');
                if (severityVal) severityVal.textContent = '6';
                crimeReportForm.style.display = 'none';
            }, 1800);

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

// Call the function to display crimes when the map loads
fetchAndDisplayCrimes();

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
        alert("Click any point on the map to set the START / SOURCE location.");
    });
}

// Pick Destination on Map Button
if (pickDestBtn) {
    pickDestBtn.addEventListener('click', () => {
        mapPickingMode = 'destination';
        alert("Click any point on the map to set the DESTINATION location.");
    });
}

// Map Click Handler for Pickers
map.on('click', async (e) => {
    if (mapPickingMode === 'report' || (crimeReportForm && crimeReportForm.style.display === 'block')) {
        const { lat, lng } = e.latlng;
        setReportLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
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
        html: '<div style="background-color: #28a745; color: white; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">S</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    sourceMarker = L.marker([lat, lon], { icon: greenIcon }).addTo(map);
    sourceMarker.bindPopup(`<b>Start Point</b><br>${label}`).openPopup();
}

function setDestinationLocation(lat, lon, label) {
    destCoords = { lat, lon };
    if (destInput) destInput.value = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    if (destMarker) map.removeLayer(destMarker);

    const redIcon = L.divIcon({
        className: 'dest-marker',
        html: '<div style="background-color: #dc3545; color: white; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">D</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    destMarker = L.marker([lat, lon], { icon: redIcon }).addTo(map);
    destMarker.bindPopup(`<b>Destination Point</b><br>${label}`).openPopup();
}

// Generate Routes Button
if (generateRoutesBtn) {
    generateRoutesBtn.addEventListener('click', async () => {
        try {
            // Resolve source coordinates if text typed
            if (!sourceCoords && sourceInput && sourceInput.value.trim() !== '') {
                const coords = await getCoordinates(sourceInput.value.trim());
                setSourceLocation(coords.lat, coords.lon, sourceInput.value.trim());
            }

            // Resolve destination coordinates if text typed
            if (!destCoords && destInput && destInput.value.trim() !== '') {
                const coords = await getCoordinates(destInput.value.trim());
                setDestinationLocation(coords.lat, coords.lon, destInput.value.trim());
            }

            if (!sourceCoords || !destCoords) {
                alert("Please select or enter both Source and Destination locations.");
                return;
            }

            routeLoadingSpinner.style.display = 'block';

            const response = await fetch('/api/routes', {
                method: 'POST',
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

function displayRoutesOnMap(data) {
    clearAllRoutesFromMap();

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

        // Render segment polylines with safety colors
        if (routeData.segments && routeData.segments.length > 0) {
            routeData.segments.forEach(seg => {
                const segmentPolyline = L.polyline([seg.start, seg.end], {
                    color: seg.color || routeData.color,
                    weight: rt.key === 'safest' ? 6 : (rt.key === 'optimal' ? 5 : 4),
                    opacity: 0.85
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
                opacity: 0.8
            }).addTo(map);
            routeLayers[rt.key].push(fallbackPolyline);
        }

        // Collect coordinates for camera bounds
        if (routeData.coordinates) {
            routeData.coordinates.forEach(c => allRouteBounds.push(c));
        }

        // Update Card UI elements
        const distEl = document.getElementById(rt.distId);
        const hazEl = document.getElementById(rt.hazId);
        const safEl = document.getElementById(rt.safId);
        const checkEl = document.getElementById(rt.checkId);

        if (distEl) distEl.textContent = `${routeData.distanceKm} km`;
        if (hazEl) hazEl.textContent = `${routeData.hazardScore}`;
        if (safEl) {
            safEl.textContent = routeData.safetyLevel;
            safEl.style.backgroundColor = routeData.safetyColor || '#666';
        }

        // Toggle checkbox listener
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

    // Fit map bounds to encompass all generated routes
    if (allRouteBounds.length > 0) {
        map.fitBounds(allRouteBounds, { padding: [50, 50] });
    }
}

