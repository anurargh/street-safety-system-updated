const { 
  ROUTING_CONSTANTS, 
  getSafetyLevelInfo 
} = require('../config/hazard-config');

const { 
  calculateDistanceKm, 
  calculateSegmentHazardScore, 
  evaluatePathSafety 
} = require('./hazard-scoring');

/**
 * Min-Heap Priority Queue for Dijkstra algorithm
 */
class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  push(val, priority) {
    this.heap.push({ val, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    return top.val;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.heap[i].priority < this.heap[p].priority) {
        [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
        i = p;
      } else break;
    }
  }

  _sinkDown(i) {
    const len = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

/**
 * Snap arbitrary coordinate to nearest real road on OpenStreetMap using OSRM
 */
async function snapToNearestRoad(lat, lon) {
  try {
    const url = `https://router.project-osrm.org/nearest/v1/driving/${lon},${lat}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [lat, lon];

    const data = await response.json();
    if (data.waypoints && data.waypoints.length > 0) {
      const loc = data.waypoints[0].location; // [lon, lat]
      return [loc[1], loc[0]];
    }
  } catch (err) {
    console.warn('OSRM nearest road snap failed:', err.message);
  }
  return [lat, lon];
}

/**
 * Fetch real driving route polylines and steps from OSRM
 */
async function fetchOSRMRoute(startLat, startLon, endLat, endLon, viaLat = null, viaLon = null) {
  try {
    let url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};`;
    if (viaLat !== null && viaLon !== null) {
      url += `${viaLon},${viaLat};`;
    }
    url += `${endLon},${endLat}?overview=full&geometries=geojson&alternatives=3&steps=true`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    if (!data.routes || data.routes.length === 0) return [];

    return data.routes.map(r => {
      // Convert OSRM [lon, lat] coordinates to [lat, lon]
      return {
        coordinates: r.geometry.coordinates.map(coord => [coord[1], coord[0]]),
        distance: r.distance,
        duration: r.duration,
        steps: r.legs && r.legs[0] && r.legs[0].steps ? r.legs[0].steps : []
      };
    });
  } catch (err) {
    console.warn('OSRM route fetch failed:', err.message);
    return [];
  }
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const toDeg = rad => (rad * 180) / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getCardinalDirection(bearing) {
  const dirs = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  return dirs[Math.round(bearing / 45) % 8];
}

function findNearbyStreetName(lat, lon, osrmSteps = []) {
  if (!osrmSteps || osrmSteps.length === 0) return null;
  let bestDist = 0.08; // 80 meters
  let bestName = null;
  for (const step of osrmSteps) {
    if (step.name && step.name.trim() !== '' && step.maneuver && step.maneuver.location) {
      const sLon = step.maneuver.location[0];
      const sLat = step.maneuver.location[1];
      const dKm = calculateDistanceKm(lat, lon, sLat, sLon);
      if (dKm < bestDist) {
        bestDist = dKm;
        bestName = step.name.trim();
      }
    }
  }
  return bestName;
}

function findNearbyHazard(lat, lon, hazards = [], maxRadiusMeters = 80) {
  if (!hazards || hazards.length === 0) return null;
  for (const h of hazards) {
    const hLat = Number(h.latitude || h.lat);
    const hLon = Number(h.longitude || h.lon || h.lng);
    if (!isNaN(hLat) && !isNaN(hLon)) {
      const distM = calculateDistanceKm(lat, lon, hLat, hLon) * 1000;
      if (distM <= maxRadiusMeters) {
        return {
          type: h.type || h.hazardType || 'Hazard',
          severity: Number(h.severity) || 5,
          location: h.location || h.address || '',
          distanceMeters: Math.round(distM)
        };
      }
    }
  }
  return null;
}

function buildTurnByTurnSteps(coords, hazards = [], osrmSteps = []) {
  if (!coords || coords.length < 2) return [];
  const steps = [];

  const initialBearing = calculateBearing(coords[0][0], coords[0][1], coords[1][0], coords[1][1]);
  const initialDir = getCardinalDirection(initialBearing);
  const initialStreet = findNearbyStreetName(coords[0][0], coords[0][1], osrmSteps);
  const initialStreetText = initialStreet ? ` on ${initialStreet}` : '';

  let currentStep = {
    stepIndex: 0,
    maneuver: 'depart',
    modifier: 'straight',
    instruction: `Head ${initialDir}${initialStreetText}`,
    shortInstruction: `Head ${initialDir}`,
    streetName: initialStreet || '',
    location: coords[0],
    coordIndex: 0,
    distanceMeters: 0,
    durationSeconds: 0,
    bearing: initialBearing,
    hazardAlert: findNearbyHazard(coords[0][0], coords[0][1], hazards, 70)
  };

  let prevBearing = initialBearing;
  let accumulatedDistMeters = 0;

  for (let i = 1; i < coords.length - 1; i++) {
    const segDistKm = calculateDistanceKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    const segDistMeters = Math.round(segDistKm * 1000);
    accumulatedDistMeters += segDistMeters;

    const nextBearing = calculateBearing(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    let diff = (nextBearing - prevBearing + 360) % 360;
    if (diff > 180) diff -= 360;

    // Detect turn if turn angle is significant (>= 28 degrees) AND distance since last maneuver is at least 35m
    if (Math.abs(diff) >= 28 && accumulatedDistMeters >= 35) {
      currentStep.distanceMeters = accumulatedDistMeters;
      currentStep.durationSeconds = Math.max(2, Math.round((accumulatedDistMeters / 1000) / 30 * 3600));
      steps.push(currentStep);

      let maneuver = 'turn-right';
      let modifier = 'right';
      let text = 'Turn right';
      let shortText = 'Turn right';

      if (diff > 20 && diff <= 50) {
        maneuver = 'slight-right';
        modifier = 'slight right';
        text = 'Bear slightly right';
        shortText = 'Bear right';
      } else if (diff > 50 && diff <= 125) {
        maneuver = 'turn-right';
        modifier = 'right';
        text = 'Turn right';
        shortText = 'Turn right';
      } else if (diff > 125) {
        maneuver = 'sharp-right';
        modifier = 'sharp right';
        text = 'Make a sharp right';
        shortText = 'Sharp right';
      } else if (diff < -20 && diff >= -50) {
        maneuver = 'slight-left';
        modifier = 'slight left';
        text = 'Bear slightly left';
        shortText = 'Bear left';
      } else if (diff < -50 && diff >= -125) {
        maneuver = 'turn-left';
        modifier = 'left';
        text = 'Turn left';
        shortText = 'Turn left';
      } else if (diff < -125) {
        maneuver = 'sharp-left';
        modifier = 'sharp left';
        text = 'Make a sharp left';
        shortText = 'Sharp left';
      }

      const turnStreet = findNearbyStreetName(coords[i][0], coords[i][1], osrmSteps);
      if (turnStreet) {
        text += ` onto ${turnStreet}`;
      }

      const stepHazard = findNearbyHazard(coords[i][0], coords[i][1], hazards, 80);

      currentStep = {
        stepIndex: steps.length,
        maneuver,
        modifier,
        instruction: text,
        shortInstruction: shortText,
        streetName: turnStreet || '',
        location: coords[i],
        coordIndex: i,
        distanceMeters: 0,
        durationSeconds: 0,
        bearing: nextBearing,
        hazardAlert: stepHazard
      };

      prevBearing = nextBearing;
      accumulatedDistMeters = 0;
    }
  }

  // Final stretch to destination
  const lastSegKm = calculateDistanceKm(coords[coords.length - 2][0], coords[coords.length - 2][1], coords[coords.length - 1][0], coords[coords.length - 1][1]);
  accumulatedDistMeters += Math.round(lastSegKm * 1000);
  currentStep.distanceMeters = Math.max(10, accumulatedDistMeters);
  currentStep.durationSeconds = Math.max(2, Math.round((currentStep.distanceMeters / 1000) / 30 * 3600));
  steps.push(currentStep);

  // Arrival step
  const finalDestStreet = findNearbyStreetName(coords[coords.length - 1][0], coords[coords.length - 1][1], osrmSteps);
  steps.push({
    stepIndex: steps.length,
    maneuver: 'arrive',
    modifier: 'straight',
    instruction: finalDestStreet ? `Arrive at destination near ${finalDestStreet}` : 'You have arrived at your destination',
    shortInstruction: 'Arrive at destination',
    streetName: finalDestStreet || '',
    location: coords[coords.length - 1],
    coordIndex: coords.length - 1,
    distanceMeters: 0,
    durationSeconds: 0,
    bearing: prevBearing,
    hazardAlert: null
  });

  return steps;
}

function findUpcomingHazardsAlongRoute(coords, hazards = [], maxDistMeters = 70) {
  if (!hazards || hazards.length === 0 || !coords || coords.length === 0) return [];
  const found = [];
  const seenIds = new Set();

  let accumulatedDistMeters = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const segDistMeters = calculateDistanceKm(p1[0], p1[1], p2[0], p2[1]) * 1000;

    for (const h of hazards) {
      const id = String(h._id || h.id || `${h.latitude},${h.longitude}`);
      if (seenIds.has(id)) continue;

      const hLat = Number(h.latitude || h.lat);
      const hLon = Number(h.longitude || h.lon || h.lng);
      if (isNaN(hLat) || isNaN(hLon)) continue;

      const d1 = calculateDistanceKm(p1[0], p1[1], hLat, hLon) * 1000;
      const d2 = calculateDistanceKm(p2[0], p2[1], hLat, hLon) * 1000;
      const minD = Math.min(d1, d2);

      if (minD <= maxDistMeters) {
        seenIds.add(id);
        found.push({
          id,
          type: h.type || h.hazardType || 'Hazard',
          severity: Number(h.severity) || 5,
          location: h.location || h.address || '',
          distanceAlongRouteMeters: Math.round(accumulatedDistMeters + minD),
          coordinates: [hLat, hLon]
        });
      }
    }
    accumulatedDistMeters += segDistMeters;
  }

  return found.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
}

/**
 * Builds a graph from real street route polylines
 */
function buildGraphFromPaths(paths, hazards) {
  const nodes = [];
  const nodeMap = new Map();
  const adjacency = [];

  function getOrCreateNodeId(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (nodeMap.has(key)) return nodeMap.get(key);

    const id = nodes.length;
    nodes.push({ id, lat, lon });
    nodeMap.set(key, id);
    adjacency.push([]);
    return id;
  }

  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const uId = getOrCreateNodeId(path[i][0], path[i][1]);
      const vId = getOrCreateNodeId(path[i + 1][0], path[i + 1][1]);

      if (uId === vId) continue;

      const seg = calculateSegmentHazardScore(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], hazards);

      // Add bidirectional street edges
      adjacency[uId].push({ to: vId, distKm: seg.lengthKm, hazardScore: seg.score });
      adjacency[vId].push({ to: uId, distKm: seg.lengthKm, hazardScore: seg.score });
    }
  }

  return { nodes, adjacency };
}

/**
 * Dijkstra Shortest Path Search on Graph
 */
function runDijkstra(graph, startId, endId, costFn) {
  const { nodes, adjacency } = graph;
  const numNodes = nodes.length;

  if (numNodes === 0) return null;

  const dist = new Array(numNodes).fill(Infinity);
  const parent = new Array(numNodes).fill(-1);
  const pq = new PriorityQueue();

  dist[startId] = 0;
  pq.push(startId, 0);

  while (!pq.isEmpty()) {
    const u = pq.pop();

    if (u === endId) break;

    for (const edge of adjacency[u]) {
      const edgeCost = costFn(edge.distKm, edge.hazardScore);
      const newCost = dist[u] + edgeCost;

      if (newCost < dist[edge.to]) {
        dist[edge.to] = newCost;
        parent[edge.to] = u;
        pq.push(edge.to, newCost);
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  // Reconstruct path along real street nodes
  const path = [];
  let curr = endId;
  while (curr !== -1) {
    path.unshift([nodes[curr].lat, nodes[curr].lon]);
    curr = parent[curr];
  }

  return path;
}

/**
 * Helper to check if two coordinate paths represent substantially the same route
 */
function isSameRoute(c1, c2) {
  if (!c1 || !c2) return false;
  if (c1.length === 0 || c2.length === 0) return false;

  const startDiff = calculateDistanceKm(c1[0][0], c1[0][1], c2[0][0], c2[0][1]);
  const endDiff = calculateDistanceKm(c1[c1.length - 1][0], c1[c1.length - 1][1], c2[c2.length - 1][0], c2[c2.length - 1][1]);
  
  const mid1 = c1[Math.floor(c1.length / 2)];
  const mid2 = c2[Math.floor(c2.length / 2)];
  const midDiff = calculateDistanceKm(mid1[0], mid1[1], mid2[0], mid2[1]);

  return startDiff < 0.05 && endDiff < 0.05 && midDiff < 0.05;
}

/**
 * Main function to generate Fastest, Safest, and Optimal routes on REAL streets
 */
async function generateRoutes(startLat, startLon, endLat, endLon, hazards = []) {
  // Snap start and end to real streets
  const snappedStart = await snapToNearestRoad(startLat, startLon);
  const snappedEnd = await snapToNearestRoad(endLat, endLon);

  const realStartLat = snappedStart[0];
  const realStartLon = snappedStart[1];
  const realEndLat = snappedEnd[0];
  const realEndLon = snappedEnd[1];

  const candidatePaths = [];
  const allOsrmSteps = [];

  // 1. Fetch direct OSRM real street routes
  const directRoutes = await fetchOSRMRoute(realStartLat, realStartLon, realEndLat, realEndLon);
  directRoutes.forEach(r => {
    if (r && r.coordinates && r.coordinates.length > 0) {
      candidatePaths.push(r.coordinates);
      if (r.steps && r.steps.length > 0) allOsrmSteps.push(...r.steps);
    }
  });

  // 2. Generate lateral detour waypoints on real streets around hazard areas
  const dLat = realEndLat - realStartLat;
  const dLon = realEndLon - realStartLon;
  const perpLat = -dLon;
  const perpLon = dLat;

  const offsetScales = [0.15, -0.15, 0.35, -0.35, 0.6, -0.6];

  const detourViaPoints = [];
  for (const scale of offsetScales) {
    // Check 1/3, 1/2, and 2/3 waypoints along the route
    for (const t of [0.33, 0.5, 0.67]) {
      const rawLat = realStartLat + t * dLat + scale * perpLat;
      const rawLon = realStartLon + t * dLon + scale * perpLon;

      detourViaPoints.push([rawLat, rawLon]);
    }
  }

  // Snap detour waypoints to real streets and fetch detour routes concurrently
  const detourPromises = detourViaPoints.slice(0, 8).map(async (rawVp) => {
    const snappedVp = await snapToNearestRoad(rawVp[0], rawVp[1]);
    return fetchOSRMRoute(
      realStartLat, realStartLon, 
      realEndLat, realEndLon, 
      snappedVp[0], snappedVp[1]
    );
  });

  const detourResults = await Promise.all(detourPromises);
  detourResults.forEach(routes => {
    if (Array.isArray(routes)) {
      routes.forEach(r => {
        if (r && r.coordinates && r.coordinates.length > 0) {
          candidatePaths.push(r.coordinates);
          if (r.steps && r.steps.length > 0) allOsrmSteps.push(...r.steps);
        }
      });
    }
  });

  // If no OSRM routes were returned, retry direct OSRM fetch once more
  if (candidatePaths.length === 0) {
    const retryDirect = await fetchOSRMRoute(realStartLat, realStartLon, realEndLat, realEndLon);
    retryDirect.forEach(r => {
      if (r && r.coordinates && r.coordinates.length > 0) {
        candidatePaths.push(r.coordinates);
        if (r.steps && r.steps.length > 0) allOsrmSteps.push(...r.steps);
      }
    });
  }

  // 3. Build street graph from all OSRM real street polylines
  const graph = buildGraphFromPaths(candidatePaths, hazards);

  let startId = 0;
  let endId = graph.nodes.length - 1;

  // Find graph node closest to start and end
  let minStartDist = Infinity;
  let minEndDist = Infinity;

  for (let i = 0; i < graph.nodes.length; i++) {
    const dS = calculateDistanceKm(realStartLat, realStartLon, graph.nodes[i].lat, graph.nodes[i].lon);
    if (dS < minStartDist) {
      minStartDist = dS;
      startId = i;
    }

    const dE = calculateDistanceKm(realEndLat, realEndLon, graph.nodes[i].lat, graph.nodes[i].lon);
    if (dE < minEndDist) {
      minEndDist = dE;
      endId = i;
    }
  }

  // 4. Run Dijkstra on real street graph for each strategy

  // Strategy A: Fastest Route (Minimizes distance / travel time)
  const fastestPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => dist) || candidatePaths[0] || [[realStartLat, realStartLon], [realEndLat, realEndLon]];

  // Strategy B: Safest Route (Strictly minimizes hazard score)
  const safestPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => hazard * 1000 + dist) || candidatePaths[1] || fastestPathCoords;

  // Strategy C: Optimal Route (Balances distance and safety score)
  const alpha = ROUTING_CONSTANTS.ALPHA;
  let beta = ROUTING_CONSTANTS.BETA;
  let optimalPathCoords = runDijkstra(graph, startId, endId, (dist, hazard) => alpha * dist + beta * hazard) || candidatePaths[2] || fastestPathCoords;

  // 5. Pareto frontier verification: Ensure Optimal is a genuine intermediate trade-off if distinct paths exist
  const isOptimalSameAsFastest = isSameRoute(optimalPathCoords, fastestPathCoords);
  const isOptimalSameAsSafest = isSameRoute(optimalPathCoords, safestPathCoords);

  if ((isOptimalSameAsFastest || isOptimalSameAsSafest) && !isSameRoute(fastestPathCoords, safestPathCoords)) {
    const testBetas = [0.0002, 0.0005, 0.001, 0.002, 0.004, 0.008, 0.015, 0.03];
    const fastestEvalTest = evaluatePathSafety(fastestPathCoords, hazards);
    const safestEvalTest = evaluatePathSafety(safestPathCoords, hazards);

    let bestIntermediatePath = null;
    let bestTradeoffScore = Infinity;

    for (const testB of testBetas) {
      const testPath = runDijkstra(graph, startId, endId, (dist, hazard) => dist + testB * hazard);
      if (!testPath) continue;

      const evalTest = evaluatePathSafety(testPath, hazards);

      // Check if this route is a true trade-off between Fastest and Safest
      const isIntermediate = 
        evalTest.totalDistanceKm >= fastestEvalTest.totalDistanceKm &&
        evalTest.totalDistanceKm <= safestEvalTest.totalDistanceKm + 0.1 &&
        evalTest.totalHazardScore <= fastestEvalTest.totalHazardScore &&
        evalTest.totalHazardScore >= safestEvalTest.totalHazardScore - 0.1 &&
        !isSameRoute(testPath, fastestPathCoords) &&
        !isSameRoute(testPath, safestPathCoords);

      if (isIntermediate) {
        // Efficiency score: distance + normalized hazard impact
        const tradeoffScore = evalTest.totalDistanceKm + 0.003 * evalTest.totalHazardScore;
        if (tradeoffScore < bestTradeoffScore) {
          bestTradeoffScore = tradeoffScore;
          bestIntermediatePath = testPath;
        }
      }
    }

    if (bestIntermediatePath) {
      optimalPathCoords = bestIntermediatePath;
    }
  }

  // 6. Evaluate safety scores and segment safety colors for each route
  const fastestEval = evaluatePathSafety(fastestPathCoords, hazards);
  const safestEval = evaluatePathSafety(safestPathCoords, hazards);
  const optimalEval = evaluatePathSafety(optimalPathCoords, hazards);

  // 7. Generate turn-by-turn navigation steps and hazards for each route
  const fastestSteps = buildTurnByTurnSteps(fastestPathCoords, hazards, allOsrmSteps);
  const safestSteps = buildTurnByTurnSteps(safestPathCoords, hazards, allOsrmSteps);
  const optimalSteps = buildTurnByTurnSteps(optimalPathCoords, hazards, allOsrmSteps);

  const fastestHazards = findUpcomingHazardsAlongRoute(fastestPathCoords, hazards, 75);
  const safestHazards = findUpcomingHazardsAlongRoute(safestPathCoords, hazards, 75);
  const optimalHazards = findUpcomingHazardsAlongRoute(optimalPathCoords, hazards, 75);

  const fastestDurationMin = Math.max(1, Math.round((fastestEval.totalDistanceKm / 30) * 60));
  const safestDurationMin = Math.max(1, Math.round((safestEval.totalDistanceKm / 30) * 60));
  const optimalDurationMin = Math.max(1, Math.round((optimalEval.totalDistanceKm / 30) * 60));

  return {
    fastestRoute: {
      name: 'Fastest Route',
      type: 'fastest',
      coordinates: fastestPathCoords,
      distanceKm: fastestEval.totalDistanceKm,
      durationMinutes: fastestDurationMin,
      hazardScore: fastestEval.totalHazardScore,
      safetyLevel: fastestEval.safetyLevelInfo.level,
      color: '#007bff', // Blue for Fastest
      safetyColor: fastestEval.safetyLevelInfo.color,
      segments: fastestEval.segments,
      steps: fastestSteps,
      upcomingHazards: fastestHazards,
      totalStepsCount: fastestSteps.length
    },
    safestRoute: {
      name: 'Safest Route',
      type: 'safest',
      coordinates: safestPathCoords,
      distanceKm: safestEval.totalDistanceKm,
      durationMinutes: safestDurationMin,
      hazardScore: safestEval.totalHazardScore,
      safetyLevel: safestEval.safetyLevelInfo.level,
      color: '#28a745', // Green for Safest
      safetyColor: safestEval.safetyLevelInfo.color,
      segments: safestEval.segments,
      steps: safestSteps,
      upcomingHazards: safestHazards,
      totalStepsCount: safestSteps.length
    },
    optimalRoute: {
      name: 'Optimal Route',
      type: 'optimal',
      coordinates: optimalPathCoords,
      distanceKm: optimalEval.totalDistanceKm,
      durationMinutes: optimalDurationMin,
      hazardScore: optimalEval.totalHazardScore,
      safetyLevel: optimalEval.safetyLevelInfo.level,
      color: '#6f42c1', // Purple for Optimal
      safetyColor: optimalEval.safetyLevelInfo.color,
      segments: optimalEval.segments,
      steps: optimalSteps,
      upcomingHazards: optimalHazards,
      totalStepsCount: optimalSteps.length
    },
    constants: {
      alpha: ROUTING_CONSTANTS.ALPHA,
      beta: ROUTING_CONSTANTS.BETA
    }
  };
}

module.exports = {
  generateRoutes,
  fetchOSRMRoute,
  snapToNearestRoad
};
