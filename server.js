const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Keep original filename
    const baseName = path.parse(file.originalname).name;
    cb(null, `${baseName}${Date.now()}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    // Relaxed filter: Accept audio types OR generic binary streams (common from mobile apps)
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      // Just log it so you know why it failed
      console.log('Rejected file type:', file.mimetype); 
      cb(new Error('Only audio files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Serve static files (uploaded audio files)
app.use('/audio', express.static(uploadsDir));

// Serve admin panel static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get list of available audio tracks
app.get('/api/tracks', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const audioFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp3', '.wav', '.m4a', '.flac'].includes(ext);
    });
    res.json(audioFiles);
  } catch (error) {
    console.error('Error reading uploads directory:', error);
    res.status(500).json({ error: 'Failed to read audio files' });
  }
});

// Upload audio file
// Upload audio file
app.post('/api/upload', upload.single('audioFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Compressing the audio file
    const inputPath = req.file.path;
    // Note: req.file.filename does not have the extension here based on your multer config
    const outputPath = path.join(uploadsDir, `${req.file.filename}.mp3`);

    ffmpeg(inputPath)
      .audioBitrate('96k')
      .audioChannels(1)
      .audioFrequency(44100)
     .audioFilters([
      'highpass=f=200',   // 1. Remove bass (waste of energy)
      'dynaudnorm=f=150:g=15'
  ])
      .format('mp3')
      .on('end', () => {
        
        // --- NEW CODE: Get final size and print logs ---
        const initialSize = req.file.size;
        const finalStats = fs.statSync(outputPath);
        const finalSize = finalStats.size;

        console.log(`--- Compression Results ---`);
        console.log(`File: ${req.file.originalname}`);
        console.log(`Initial Size: ${(initialSize / 1024).toFixed(2)} KB`);
        console.log(`Final Size:   ${(finalSize / 1024).toFixed(2)} KB`);
        console.log(`Reduction:    ${((1 - finalSize / initialSize) * 100).toFixed(2)}%`);
        console.log(`---------------------------`);
        // ---------------------------------------------

        fs.unlinkSync(inputPath); // Delete the uncompressed upload

        res.json({
          message: 'File uploaded successfully',
          originalName: req.file.originalname,
          compressedFile: `${req.file.filename}.mp3`,
          uploadTime: new Date().toISOString(),
          // Optional: Send sizes back to the client as well
          initialSizeBytes: initialSize,
          finalSizeBytes: finalSize
        });
      })
      .on('error', (err) => {
        console.error("FFmpeg error:", err);
        // Ensure we try to clean up the temp file even on error
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        res.status(500).json({ error: 'Compression failed' });
      })
      .save(outputPath);

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});
// Delete audio file
app.delete('/api/tracks/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(uploadsDir, filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get file info
app.get('/api/tracks/:filename/info', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(uploadsDir, filename);

    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      res.json({
        filename: filename,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Serve admin panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  res.status(500).json({ error: error.message });
});



app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel available at http://localhost:${PORT}`);
  console.log(`Upload directory: ${uploadsDir}`);
});
