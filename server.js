// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB schema with validation
const emailSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    name: {
        type: String,
        trim: true
    },
    trackingId: {
        type: String,
        required: true,
        unique: true
    },
    sentAt: {
        type: Date,
        default: Date.now
    },
    openedAt: Date,
    clickedAt: Date
});

const Email = mongoose.model('Email', emailSchema);

// Generate secure tracking ID
const generateTrackingId = () => crypto.randomBytes(16).toString('hex');

// Register new email
app.post('/register', async (req, res) => {
    try {
        const { email, name } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const trackingId = generateTrackingId();
        const emailDoc = await Email.create({
            email,
            name,
            trackingId,
            sentAt: new Date()
        });

        res.status(201).json({ 
            trackingId,
            message: 'Email registered successfully'
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ 
            error: 'Failed to register email',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Track email open
app.get('/track/:id/open.gif', async (req, res) => {
    try {
        const { id } = req.params;
        
        await Email.findOneAndUpdate(
            { trackingId: id },
            { openedAt: new Date() },
            { new: true }
        );

        const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': gif.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, private'
        });
        res.end(gif);
    } catch (error) {
        console.error('Open tracking error:', error);
        // Return blank GIF even on error
        const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': gif.length
        });
        res.end(gif);
    }
});

// Track link clicks
app.get('/track/:id/click', async (req, res) => {
    try {
        const { id } = req.params;
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        await Email.findOneAndUpdate(
            { trackingId: id },
            { clickedAt: new Date() },
            { new: true }
        );

        res.redirect(url);
    } catch (error) {
        console.error('Click tracking error:', error);
        // Redirect even on error
        res.redirect(req.query.url || '/');
    }
});

// Get statistics
app.get('/stats', async (req, res) => {
    try {
        const [total, opened, clicked] = await Promise.all([
            Email.countDocuments(),
            Email.countDocuments({ openedAt: { $exists: true } }),
            Email.countDocuments({ clickedAt: { $exists: true } })
        ]);

        res.json({
            total,
            opened,
            clicked,
            openRate: total ? `${((opened/total) * 100).toFixed(1)}%` : '0%',
            clickRate: total ? `${((clicked/total) * 100).toFixed(1)}%` : '0%'
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));