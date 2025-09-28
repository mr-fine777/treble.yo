const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://treble.top');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});
app.use(express.json());

// Read bad words list
const badWords = fs.readFileSync(path.join(__dirname, '../badwords.txt'), 'utf-8')
    .split('\n')
    .filter(word => word.trim() !== '');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://hubberhubber:fygu34f4gy3ufg2uyhfb3guy4ghf782ufh434fbt2g3yu24bh2y4g@cluster0.914ex.mongodb.net/Treble?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // Increased timeout
    socketTimeoutMS: 45000,
    family: 4 // Force IPv4
})
.then(() => {
    console.log('Successfully connected to MongoDB.');
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    // Keep the server running even if MongoDB fails to connect initially
});

// Handle MongoDB connection events
mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
});

// Define Schema
const patternSchema = new mongoose.Schema({
    patternUrl: String,
    patternName: String,
    authorName: String,
    description: String,
    slug: { type: String, unique: true, required: true }, // Added slug field
    dateUploaded: { type: Date, default: Date.now },
    thumbnailUrl: String, // New field for thumbnail URL
    likes: { type: Number, default: 0 } // Add likes field with default value of 0
});

const Pattern = mongoose.model('TrebleUpload', patternSchema);

// Validation functions
function containsBadWords(text) {
    if (!text) return false;
    
    const lowerText = text.toLowerCase();
    // Remove common special characters that might be used to bypass filters
    const cleanText = lowerText
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Check for exact word matches using word boundaries
    return badWords.some(word => {
        const wordLower = word.trim().toLowerCase();
        if (!wordLower) return false;

        // Create a regex pattern with word boundaries
        const pattern = new RegExp(`\\b${wordLower}\\b`, 'i');
        
        // Check original text and cleaned text
        return pattern.test(lowerText) || pattern.test(cleanText);
    });
}

function isValidFileType(url) {
    const validExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    const extension = path.extname(url).toLowerCase();
    return validExtensions.includes(extension);
}

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'Treble.yo API is running' });
});

// Get pattern by slug
app.get('/pattern/:slug', async (req, res) => {
    try {
        const pattern = await Pattern.findOne({ slug: req.params.slug });
        if (!pattern) {
            return res.status(404).json({ error: 'Pattern not found' });
        }
        res.json(pattern);
    } catch (error) {
        console.error('Error fetching pattern:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        // Create a case-insensitive regex pattern
        const searchRegex = new RegExp(query, 'i');

        // Search across multiple fields
        const patterns = await Pattern.find({
            $or: [
                { patternName: searchRegex },
                { authorName: searchRegex },
                { description: searchRegex }
            ]
        }).sort({ dateUploaded: -1 }); // Sort by newest first

        res.json(patterns);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upload endpoint
app.post('/upload', async (req, res) => {
    try {
        const { patternUrl, patternName, authorName, description, slug, thumbnailUrl } = req.body;

        // Validate required fields
        if (!patternUrl || !patternName || !authorName || !description || !slug) {
            return res.status(400).json({ error: 'Pattern URL, name, author name, and description are required' });
        }

        // Check if slug already exists
        const existingPattern = await Pattern.findOne({ slug });
        if (existingPattern) {
            return res.status(400).json({ error: 'This pattern ID already exists. Please try again.' });
        }

        // Check for bad words in all fields including URL
        if (containsBadWords(patternUrl) || 
            containsBadWords(patternName) || 
            containsBadWords(authorName) || 
            containsBadWords(description)) {
            return res.status(400).json({ error: 'Inappropriate Language Detected' });
        }

        // Validate file type
        if (!isValidFileType(patternUrl)) {
            return res.status(400).json({ error: 'Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.' });
        }

        // Validate thumbnail URL file type if provided
        if (thumbnailUrl) {
            const validImageExtensions = ['.webp', '.png', '.jpeg', '.jpg'];
            const thumbnailExtension = path.extname(thumbnailUrl).toLowerCase();
            if (!validImageExtensions.includes(thumbnailExtension)) {
                return res.status(400).json({ error: 'Invalid thumbnail file type. Only .webp, .png, .jpeg, and .jpg are allowed.' });
            }
        }

        // Create new pattern
        const pattern = new Pattern({
            patternUrl,
            patternName,
            authorName,
            description,
            slug,
            thumbnailUrl,
            likes: 0 // Initialize likes to 0 for new patterns
        });

        // Save to database
        await pattern.save();

        res.status(201).json({ message: 'Pattern uploaded successfully' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Like endpoint
app.post('/like/:slug', async (req, res) => {
    try {
        const pattern = await Pattern.findOne({ slug: req.params.slug });
        if (!pattern) {
            return res.status(404).json({ error: 'Pattern not found' });
        }

        // Increment likes by 1
        pattern.likes = (pattern.likes || 0) + 1;
        await pattern.save();

        res.json({ likes: pattern.likes });
    } catch (error) {
        console.error('Error liking pattern:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Export the Express API
module.exports = app;
