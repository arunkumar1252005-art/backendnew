const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const app = express();
// const gtts= require('gtts');
require('dotenv').config();
const PORT = process.env.PORT || 3000;
// Cloudinary
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
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


//TEXT TO SPEECH ENDPOINT

const gTTS = require('gtts');

app.post('/api/text-to-audio', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const timestamp = Date.now();
    const rawAudio = path.join(uploadsDir, `tts_${timestamp}.wav`);
    const compressedAudio = path.join(uploadsDir, `tts_${timestamp}.mp3`);

    //  TEXT → AUDIO
    const tts = new gTTS(text, 'en');
    tts.save(rawAudio, () => {

      //  COMPRESS AUDIO
      ffmpeg(rawAudio)
        .audioBitrate('96k')
        .audioChannels(1)
        .format('mp3')
        .on('end', () => {

          //  UPLOAD TO CLOUDINARY
          cloudinary.uploader.upload(
            compressedAudio,
            {
              resource_type: 'raw',
              folder: 'esp32_audio'
            },
            (error, result) => {
              if (error) {
                console.error('Cloudinary Error:', error);
                return res.status(500).json({ error: 'Cloudinary upload failed' });
              }

              // CLEANUP AFTER SUCCESS
              fs.unlinkSync(rawAudio);
              fs.unlinkSync(compressedAudio);

              res.json({
                message: 'Text converted to audio successfully',
                url: result.secure_url,
                public_id: result.public_id
              });
            }
          );
        })
        .on('error', err => {
          console.error('FFmpeg error:', err);
          res.status(500).json({ error: 'Audio compression failed' });
        })
        .save(compressedAudio);
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Text to audio failed' });
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
