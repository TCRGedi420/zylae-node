// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;

// Base URL of your Zylae Saavn API instance
const API_BASE = process.env.API_BASE || 'https://zylaes-saavn.vercel.app/api';

// Configure ffmpeg
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// ---------- Security & middlewares ----------

// Custom Helmet config so CSP works with Saavn images, media & external libs
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https://c.saavncdn.com",
          "https://*.saavncdn.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
          "data:"
        ],

        // ⬇️ allow API + tfjs network calls
        connectSrc: [
          "'self'",
          "https://zylaes-saavn.vercel.app",
          "https://cdn.jsdelivr.net"
        ],

        mediaSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    }
  })
);

app.use(compression());
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Static files (frontend)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper: proxy GET requests to Zylae Saavn API
 */
async function proxyGet(req, res, apiPath) {
  try {
    const url = `${API_BASE}${apiPath}`;
    const { data, status } = await axios.get(url, {
      params: req.query,
      timeout: 10000
    });
    res.status(status).json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    const status = err.response?.status || 500;
    res.status(status).json({
      success: false,
      message: 'Upstream API error',
      error: err.message
    });
  }
}

/**
 * Proxy routes – these match what your player.js uses
 */
app.get('/api/search/songs', (req, res) => {
  // player.js calls: /api/search/songs?query=&limit=
  return proxyGet(req, res, '/search/songs');
});

app.get('/api/songs/:id', (req, res) => {
  const { id } = req.params;
  return proxyGet(req, res, `/songs/${id}`);
});

app.get('/api/songs/:id/suggestions', (req, res) => {
  const { id } = req.params;
  return proxyGet(req, res, `/songs/${id}/suggestions`);
});

app.get('/api/artists/:id/songs', (req, res) => {
  const { id } = req.params;
  return proxyGet(req, res, `/artists/${id}/songs`);
});

/**
 * Download route (MP3 via FFmpeg, with metadata)
 * GET /api/download/:id?quality=320kbps
 */
app.get('/api/download/:id', async (req, res) => {
  const { id } = req.params;
  const quality = req.query.quality || '320kbps';

  try {
    // 1) Fetch song metadata
    const songResp = await axios.get(`${API_BASE}/songs/${id}`, { timeout: 10000 });
    const songData = songResp.data?.data?.[0];

    if (!songData) {
      return res.status(404).json({ success: false, message: 'Song not found' });
    }

    const title = songData.name || 'Unknown Title';
    const artists = (songData.artists?.primary || []).map(a => a.name).join(', ');
    const album = songData.album?.name || songData.album || '';
    const year = songData.year || '';
    const duration = songData.duration || '';

    const downloadUrlEntry =
      songData.downloadUrl?.find(d => d.quality === quality) ||
      songData.downloadUrl?.slice(-1)[0];

    if (!downloadUrlEntry?.url) {
      return res.status(400).json({
        success: false,
        message: `Download URL for quality ${quality} not available`
      });
    }

    const sourceUrl = downloadUrlEntry.url;

    // 2) FFmpeg stream to MP3
    const safeFilename = `${artists ? artists + ' - ' : ''}${title}${year ? ' (' + year + ')' : ''}`
      .replace(/[\/\\?%*:|"<>]/g, '_');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.mp3"`);

    const ff = ffmpeg(sourceUrl)
      .audioCodec('libmp3lame')
      .format('mp3')
      .audioBitrate(quality.replace('kbps', '') || '320')
      .outputOptions([
        `-metadata`, `title=${title}`,
        `-metadata`, `artist=${artists}`,
        `-metadata`, `album=${album}`,
        `-metadata`, `date=${year}`,
        `-metadata`, `comment=Downloaded via ZYLAE`
      ]);

    ff.on('start', cmd => console.log('FFmpeg started:', cmd));
    ff.on('error', err => {
      console.error('FFmpeg error:', err.message);
      if (!res.headersSent) {
        res.status(500).end('Download failed');
      } else {
        res.end();
      }
    });
    ff.on('end', () => {
      console.log('FFmpeg processing finished for', id);
    });

    ff.pipe(res, { end: true });
  } catch (err) {
    console.error('Download error:', err.message);
    const status = err.response?.status || 500;
    if (!res.headersSent) {
      res.status(status).json({
        success: false,
        message: 'Download failed',
        error: err.message
      });
    } else {
      res.end();
    }
  }
});

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
