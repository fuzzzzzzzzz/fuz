const { clipboard } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let lastTextHash = '';
let lastImageHash = '';
let intervalId = null;
let onNewItem = null;
let db = null;
let imagesDir = '';

function hash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

function start(database, imagesDirectory, newItemCallback) {
  db = database;
  imagesDir = imagesDirectory;
  onNewItem = newItemCallback;

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  check();
  intervalId = setInterval(check, 300);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function check() {
  const formats = clipboard.availableFormats();

  if (formats.some(f => f.startsWith('image/'))) {
    checkImage();
  } else {
    checkText();
  }
}

function checkImage() {
  const img = clipboard.readImage();
  if (img.isEmpty()) return;

  const pngBuffer = img.toPNG();
  const currentHash = hash(pngBuffer);

  if (currentHash === lastImageHash) return;
  lastImageHash = currentHash;
  lastTextHash = '';

  const filename = `${Date.now()}.png`;
  const imagePath = path.join(imagesDir, filename);
  fs.writeFileSync(imagePath, pngBuffer);

  const item = db.addItem('image', imagePath);
  if (item && onNewItem) {
    onNewItem(item);
  }
}

function checkText() {
  const text = clipboard.readText();
  if (!text || !text.trim()) return;

  const currentHash = hash(text);

  if (currentHash === lastTextHash) return;
  lastTextHash = currentHash;
  lastImageHash = '';

  const item = db.addItem('text', text);
  if (item && onNewItem) {
    onNewItem(item);
  }
}

module.exports = { start, stop };
