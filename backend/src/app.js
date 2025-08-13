const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const scraperRoutes = require('./routes/scraperRoutes');
const matchRoutes = require('./routes/matches');
const teamVisualsRoutes = require('./routes/teamVisuals');
const logRoutes = require('./routes/logs');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Security middleware
app.use(helmet());

// Enable CORS for the frontend origin
const allowedOrigins = ['http://localhost:3000']; // Add more origins in production if needed
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'], // Allow necessary methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow necessary headers
  credentials: true // Allow cookies/auth if needed
}));

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API routes with prefix
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(`${apiPrefix}/scraper`, scraperRoutes);
app.use(`${apiPrefix}/matches`, matchRoutes);
app.use(`${apiPrefix}/team-visuals`, teamVisualsRoutes);
app.use(`${apiPrefix}/logs`, logRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// Error handling middleware (should be last)
app.use(errorHandler);

module.exports = app;