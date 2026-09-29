const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const cors = require('cors');

const User = require('./user');
const Crime = require('./crime');

const { generateRoutes } = require('./services/routing');
const { 
  HAZARD_WEIGHTS, 
  HAZARD_INFLUENCE_RADIUS_METERS, 
  ROUTING_CONSTANTS, 
  SAFETY_LEVELS 
} = require('./config/hazard-config');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'streetsafety_jwt_secret_dev_key_2026';

app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Helper to sign JWT
function generateToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
}

// Helper to set secure cookie (SameSite=None, Secure=true for iframe compatibility)
function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

// Authentication middleware accepting both Cookie and Authorization: Bearer <token>
function requireAuth(req, res, next) {
  let token = req.cookies && req.cookies.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.email) {
        req.user = { email: decoded.email };
        return next();
      }
    } catch (err) {
      // Token verification failed, fallback to header check
    }
  }

  const fallbackEmail = req.headers['x-user-email'];
  if (fallbackEmail && typeof fallbackEmail === 'string' && fallbackEmail.includes('@')) {
    req.user = { email: fallbackEmail.trim().toLowerCase() };
    return next();
  }

  return res.status(401).json({ error: 'Please log in to continue' });
}

// Serve landing page at root and index
app.get(['/', '/index.html', '/landing'], (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'));
});

// In-Memory and File-backed store fallback
let isMongoConnected = false;

const fs = require('fs');
const usersFilePath = path.join(__dirname, 'data', 'users.json');
let inMemoryUsers = [];

function loadInMemoryUsers() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const raw = fs.readFileSync(usersFilePath, 'utf8');
      inMemoryUsers = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read users.json:', err.message);
  }
}
loadInMemoryUsers();

function saveInMemoryUsers() {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(inMemoryUsers, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not persist users.json:', err.message);
  }
}

// Persistent user-reported hazards store
const userHazardsFilePath = path.join(__dirname, 'data', 'user_hazards.json');
let userHazards = [];

function loadUserHazards() {
  try {
    if (fs.existsSync(userHazardsFilePath)) {
      const raw = fs.readFileSync(userHazardsFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        userHazards = parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read user_hazards.json:', err.message);
    userHazards = [];
  }
}
loadUserHazards();

function saveUserHazards() {
  try {
    fs.writeFileSync(userHazardsFilePath, JSON.stringify(userHazards, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not persist user_hazards.json:', err.message);
  }
}

let simulatedCrimes = [];

try {
  const crimesPath = path.join(__dirname, 'data', 'crimes.json');
  if (fs.existsSync(crimesPath)) {
    const rawData = fs.readFileSync(crimesPath, 'utf8');
    const parsed = JSON.parse(rawData);
    simulatedCrimes = parsed.map((item) => ({
      _id: item.id || item._id,
      id: item.id,
      type: item.hazardType || item.type,
      hazardType: item.hazardType || item.type,
      location: item.description,
      address: item.description,
      details: item.description,
      description: item.description,
      latitude: item.latitude,
      longitude: item.longitude,
      severity: item.severity,
      upvotes: item.verificationCount || 5,
      downvotes: 0,
      upvotedBy: [],
      downvotedBy: [],
      status: item.status,
      timestamp: item.timestamp,
      verificationCount: item.verificationCount,
      hazardRadius: item.hazardRadius,
      isUserReported: false,
      reportedBy: 'Municipal Sensor Network',
      reportedByName: 'Civic Sensor Network',
      createdAt: item.timestamp ? new Date(item.timestamp) : new Date()
    }));
  }
} catch (err) {
  console.warn('Failed to load crimes.json dataset:', err.message);
}

// Helper to get all combined hazards with persistent user hazards always at top
function getAllHazards() {
  const sortedUser = [...userHazards].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
  return [...sortedUser, ...simulatedCrimes];
}

// Optional MongoDB connection if explicitly provided
if (process.env.MONGODB_URI) {
  mongoose.set('bufferCommands', false);
  mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 2000
  }).then(() => {
    isMongoConnected = true;
    console.log('MongoDB connected');
  }).catch(err => {
    isMongoConnected = false;
    console.warn('MongoDB connection unavailable — operating in persistent storage mode');
  });
}

// Registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (username || cleanEmail.split('@')[0]).trim();

    if (isMongoConnected) {
      try {
        const user = new User({ username: cleanUsername, email: cleanEmail, password });
        await user.save();
        const token = generateToken(cleanEmail);
        setAuthCookie(res, token);
        return res.status(201).json({
          message: 'User registered successfully',
          token,
          user: { email: cleanEmail, username: cleanUsername }
        });
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        } else {
          return res.status(400).json({ error: 'Registration failed: ' + dbErr.message });
        }
      }
    }

    // In-memory fallback with file persistence
    const existing = inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'User already exists with that email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = {
      _id: 'user_' + Date.now(),
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    inMemoryUsers.push(newUser);
    saveInMemoryUsers();

    const token = generateToken(cleanEmail);
    setAuthCookie(res, token);
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { email: cleanEmail, username: cleanUsername }
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (isMongoConnected) {
      try {
        const user = await User.findOne({ email: cleanEmail });
        if (user && (await user.comparePassword(password))) {
          const token = generateToken(user.email);
          setAuthCookie(res, token);
          return res.status(200).json({
            message: 'Login successful',
            token,
            user: { email: user.email, username: user.username }
          });
        } else if (user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // In-memory fallback
    const memUser = inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (memUser) {
      const match = await bcrypt.compare(password, memUser.password);
      if (match) {
        const token = generateToken(memUser.email);
        setAuthCookie(res, token);
        return res.status(200).json({
          message: 'Login successful',
          token,
          user: { email: memUser.email, username: memUser.username }
        });
      } else {
        return res.status(401).json({ error: 'Invalid credentials. Please verify password.' });
      }
    }

    // Auto-register convenience in in-memory mode so citizens are never locked out
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = {
      _id: 'user_' + Date.now(),
      username: cleanEmail.split('@')[0],
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    inMemoryUsers.push(newUser);
    saveInMemoryUsers();

    const token = generateToken(cleanEmail);
    setAuthCookie(res, token);
    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { email: cleanEmail, username: newUser.username }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Firebase Auth session synchronizer (Google Sign-In, Firebase accounts)
app.post('/api/firebase-auth', async (req, res) => {
  try {
    const { email, displayName, uid, providerId } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email identifier is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (displayName || cleanEmail.split('@')[0]).trim();

    if (isMongoConnected) {
      try {
        let user = await User.findOne({ email: cleanEmail });
        if (!user) {
          const dummyPassword = await bcrypt.hash(uid || ('user_' + Date.now()), 10);
          user = new User({ username: cleanUsername, email: cleanEmail, password: dummyPassword });
          await user.save();
        }
      } catch (dbErr) {
        console.warn('MongoDB sync note:', dbErr.message);
      }
    }

    // Also persist in local users store
    let memUser = inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (!memUser) {
      memUser = {
        _id: uid || ('user_' + Date.now()),
        username: cleanUsername,
        email: cleanEmail,
        providerId: providerId || 'google.com',
        createdAt: new Date().toISOString()
      };
      inMemoryUsers.push(memUser);
      saveInMemoryUsers();
    } else {
      memUser.username = cleanUsername || memUser.username;
      memUser.providerId = providerId || memUser.providerId;
      saveInMemoryUsers();
    }

    const token = generateToken(cleanEmail);
    setAuthCookie(res, token);
    return res.status(200).json({
      message: 'Citizen authenticated successfully',
      token,
      user: { email: cleanEmail, username: cleanUsername, uid }
    });
  } catch (err) {
    res.status(500).json({ error: 'Session synchronization failed: ' + err.message });
  }
});

// Check current session
app.get('/api/me', requireAuth, (req, res) => {
  res.status(200).json({ email: req.user.email });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'none',
    secure: true
  });
  res.status(200).json({ message: 'Logged out successfully' });
});

// Submit hazard/crime report (Authenticated)
app.post('/api/crimes', requireAuth, async (req, res) => {
  try {
    const { type, hazardType, location, details, latitude, longitude, address, severity: reqSeverity, reportedByName: clientReportedByName } = req.body;

    const actualType = hazardType || type;
    if (!actualType) {
      return res.status(400).json({ message: 'Hazard type is required' });
    }

    let finalSeverity = 5; // default moderate
    if (reqSeverity !== undefined && !isNaN(Number(reqSeverity))) {
      finalSeverity = Math.max(1, Math.min(10, Number(reqSeverity)));
    } else {
      const redSeverityCrimes = ['murder', 'rape', 'robbery', 'violent assault', 'violent_assault', 'road accident', 'flooded road', 'fire hazard'];
      const crimeTypeLower = String(actualType).toLowerCase();
      if (redSeverityCrimes.some(k => crimeTypeLower.includes(k))) {
        finalSeverity = 8;
      } else {
        finalSeverity = 5;
      }
    }

    const lat = Number(latitude) || 0;
    const lon = Number(longitude) || 0;
    const locText = location || address || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    const cleanEmail = (req.user && req.user.email ? req.user.email : '').trim().toLowerCase();
    const matchedUser = inMemoryUsers.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    const resolvedName = (clientReportedByName && clientReportedByName.trim()) 
      || (matchedUser && matchedUser.username) 
      || (cleanEmail ? cleanEmail.split('@')[0] : 'Citizen');

    const hazardId = 'hazard_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const nowIso = new Date().toISOString();

    const crimeData = {
      _id: hazardId,
      id: hazardId,
      type: actualType,
      hazardType: actualType,
      location: locText,
      address: address || locText,
      details: details || locText,
      description: details || locText,
      latitude: lat,
      longitude: lon,
      severity: finalSeverity,
      upvotes: 0,
      downvotes: 0,
      upvotedBy: [],
      downvotedBy: [],
      status: 'pending verification',
      verificationCount: 0,
      hazardRadius: 100,
      reportedBy: cleanEmail,
      reportedByName: resolvedName,
      isUserReported: true,
      timestamp: nowIso,
      createdAt: nowIso
    };

    if (isMongoConnected) {
      try {
        const newCrime = new Crime({
          type: actualType,
          location: locText,
          details: details || locText,
          latitude: lat,
          longitude: lon,
          address: address || locText,
          severity: finalSeverity,
          upvotes: 1,
          downvotes: 0,
          upvotedBy: [cleanEmail]
        });
        await newCrime.save();
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // Persist immediately in user_hazards.json file
    userHazards.unshift(crimeData);
    saveUserHazards();

    console.log(`[Hazard Report] Created by ${resolvedName} (${cleanEmail}): ${actualType} at ${locText}`);
    return res.status(201).json({ message: 'Hazard report submitted successfully!', crime: crimeData });
  } catch (error) {
    console.error('Error submitting hazard report:', error);
    res.status(500).json({ message: 'Error submitting hazard report', error: error.message });
  }
});

// Get all crimes, with persistent user hazards first (Public)
app.get('/api/crimes', async (req, res) => {
  try {
    const sortedUserHazards = [...userHazards].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));

    // Support returning only user-reported hazards if requested
    if (req.query.userOnly === 'true') {
      return res.status(200).json(sortedUserHazards);
    }

    // Always put real citizen hazards at the top, followed by simulated baseline
    const combined = [...sortedUserHazards, ...simulatedCrimes];
    res.status(200).json(combined);
  } catch (error) {
    console.error('Error fetching crimes:', error);
    res.status(500).json({ message: 'Error fetching crimes', error: error.message });
  }
});

// Upvote a hazard (Authenticated - Peer Citizen Reports Only)
app.post('/api/crimes/:id/upvote', requireAuth, async (req, res) => {
  try {
    const userEmail = (req.user && req.user.email ? req.user.email : '').trim().toLowerCase();
    const crimeId = req.params.id;

    // Check user-reported hazards first
    const userCrime = userHazards.find(c => String(c._id) === String(crimeId) || String(c.id) === String(crimeId));
    if (userCrime) {
      if (userCrime.reportedBy && userCrime.reportedBy.trim().toLowerCase() === userEmail) {
        return res.status(400).json({ message: 'You cannot vote on your own hazard report', crime: userCrime });
      }
      if (!userCrime.upvotedBy) userCrime.upvotedBy = [];
      if (!userCrime.downvotedBy) userCrime.downvotedBy = [];

      // If user has already upvoted, clicking upvote again toggles it off
      if (userCrime.upvotedBy.includes(userEmail)) {
        userCrime.upvotes = Math.max(0, (userCrime.upvotes || 1) - 1);
        userCrime.upvotedBy = userCrime.upvotedBy.filter(email => email !== userEmail);
        userCrime.verificationCount = userCrime.upvotes;
        userCrime.status = userCrime.upvotes >= 1 ? 'verified' : 'pending verification';
        saveUserHazards();
        return res.status(200).json({ message: 'Upvote removed', crime: userCrime });
      }

      // If user had previously downvoted, remove their downvote
      if (userCrime.downvotedBy.includes(userEmail)) {
        userCrime.downvotes = Math.max(0, (userCrime.downvotes || 1) - 1);
        userCrime.downvotedBy = userCrime.downvotedBy.filter(email => email !== userEmail);
      }

      // Add upvote
      userCrime.upvotes = (userCrime.upvotes || 0) + 1;
      userCrime.verificationCount = userCrime.upvotes;
      userCrime.upvotedBy.push(userEmail);
      userCrime.status = userCrime.upvotes >= 1 ? 'verified' : 'pending verification';
      saveUserHazards();
      return res.status(200).json({ message: 'Hazard verified', crime: userCrime });
    }

    // Explicitly reject simulated data voting
    const simCrime = simulatedCrimes.find(c => String(c._id) === String(crimeId) || String(c.id) === String(crimeId));
    if (simCrime) {
      return res.status(400).json({ message: 'Consensus voting is strictly for citizen reports. Simulated data cannot be voted on.' });
    }

    return res.status(404).json({ message: 'Hazard not found' });
  } catch (error) {
    console.error('Error upvoting crime:', error);
    res.status(500).json({ message: 'Error upvoting hazard', error: error.message });
  }
});

// Downvote a hazard (Authenticated - Peer Citizen Reports Only)
app.post('/api/crimes/:id/downvote', requireAuth, async (req, res) => {
  try {
    const userEmail = (req.user && req.user.email ? req.user.email : '').trim().toLowerCase();
    const crimeId = req.params.id;

    // Check user-reported hazards first
    const userCrime = userHazards.find(c => String(c._id) === String(crimeId) || String(c.id) === String(crimeId));
    if (userCrime) {
      if (userCrime.reportedBy && userCrime.reportedBy.trim().toLowerCase() === userEmail) {
        return res.status(400).json({ message: 'You cannot vote on your own hazard report', crime: userCrime });
      }
      if (!userCrime.upvotedBy) userCrime.upvotedBy = [];
      if (!userCrime.downvotedBy) userCrime.downvotedBy = [];

      // If user has already downvoted, clicking downvote again toggles it off
      if (userCrime.downvotedBy.includes(userEmail)) {
        userCrime.downvotes = Math.max(0, (userCrime.downvotes || 1) - 1);
        userCrime.downvotedBy = userCrime.downvotedBy.filter(email => email !== userEmail);
        saveUserHazards();
        return res.status(200).json({ message: 'Dismissal removed', crime: userCrime });
      }

      // If user had previously upvoted, remove their upvote
      if (userCrime.upvotedBy.includes(userEmail)) {
        userCrime.upvotes = Math.max(0, (userCrime.upvotes || 1) - 1);
        userCrime.upvotedBy = userCrime.upvotedBy.filter(email => email !== userEmail);
        userCrime.verificationCount = userCrime.upvotes;
        userCrime.status = userCrime.upvotes >= 1 ? 'verified' : 'pending verification';
      }

      // Add downvote
      userCrime.downvotes = (userCrime.downvotes || 0) + 1;
      userCrime.downvotedBy.push(userEmail);
      saveUserHazards();
      return res.status(200).json({ message: 'Hazard dismissed', crime: userCrime });
    }

    // Explicitly reject simulated data voting
    const simCrime = simulatedCrimes.find(c => String(c._id) === String(crimeId) || String(c.id) === String(crimeId));
    if (simCrime) {
      return res.status(400).json({ message: 'Consensus voting is strictly for citizen reports. Simulated data cannot be voted on.' });
    }

    return res.status(404).json({ message: 'Hazard not found' });
  } catch (error) {
    console.error('Error downvoting crime:', error);
    res.status(500).json({ message: 'Error dismissing hazard', error: error.message });
  }
});

// Endpoint to fetch hazard configuration & scoring rules
app.get('/api/hazard-config', (req, res) => {
  res.status(200).json({
    hazardWeights: HAZARD_WEIGHTS,
    hazardRadii: HAZARD_INFLUENCE_RADIUS_METERS,
    routingConstants: ROUTING_CONSTANTS,
    safetyLevels: SAFETY_LEVELS
  });
});

// Navigation & Safety-Aware Route Generation Endpoint
app.post('/api/routes', async (req, res) => {
  try {
    const { source, destination } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ message: 'Source and destination are required' });
    }

    const startLat = parseFloat(source.lat || source.latitude);
    const startLon = parseFloat(source.lon || source.lng || source.longitude);
    const endLat = parseFloat(destination.lat || destination.latitude);
    const endLon = parseFloat(destination.lon || destination.lng || destination.longitude);

    if (isNaN(startLat) || isNaN(startLon) || isNaN(endLat) || isNaN(endLon)) {
      return res.status(400).json({ message: 'Invalid latitude or longitude format' });
    }

    // Fetch active crimes/hazards with persistent user hazards prioritized
    const hazards = getAllHazards();
    const routeResults = await generateRoutes(startLat, startLon, endLat, endLon, hazards);

    res.status(200).json({
      ...routeResults,
      source: { lat: startLat, lon: startLon },
      destination: { lat: endLat, lon: endLon }
    });
  } catch (error) {
    console.error('Error generating routes:', error);
    res.status(500).json({ message: 'Error generating routes', error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
