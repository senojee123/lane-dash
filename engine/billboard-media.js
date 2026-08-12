/* ============================================================================
   BILLBOARD-MEDIA.JS — ENGINE (generic, shared by every content pack).
   Turns a creative descriptor ({ type: 'image'|'video', url }) into a
   THREE.Texture, cached by url so multiple billboard instances showing the
   same creative share one decode (one <video> element, one texture) instead
   of each spawning its own. No content-pack knowledge lives here — only
   RunnerBillboards (this pack's billboards.js) supplies what plays.

   Also exposes getImageTexture(url, aspect, backingColorHex) — the same
   contain-fit compositing, generalized for anything else that wants one
   image on a fixed-aspect surface outside the billboard creative/placement
   system. brand.js's optional coin face image uses this directly.

   Depends on THREE (loaded via the CDN <script> tags in index.html) and,
   for image creatives, RunnerTheme.BILLBOARD's panel aspect ratio/backing
   color (theme.js) — read lazily inside buildImageTexture(), only once a
   billboard actually spawns, long after every script has loaded, so this
   file itself is still safe to load early/before the content pack's own
   scripts despite that reference. Nothing here reads AssetRegistry/Palette.

   Texture creation is synchronous from the caller's side: a Texture/
   VideoTexture object is created and returned immediately, and its
   underlying image/video populates asynchronously — three.js only uploads
   to the GPU once the source is actually ready, so assigning the returned
   texture as a material's `.map` straight away is safe even before it has
   loaded (it just renders blank/last-frame until then).
============================================================================ */
const BillboardMedia = {
  _cache: {},          // creative.url -> THREE.Texture
  _placeholderTexture: null,
};

/**
 * A neutral "ad slot" panel for when a billboard has no creative assigned
 * (empty RunnerBillboards, or a URL that fails to load) — so an unfilled
 * slot still reads as intentional ad inventory, not a rendering bug.
 */
BillboardMedia.getPlaceholder = function () {
  if (this._placeholderTexture) return this._placeholderTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = '#8a94a6';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOUR AD HERE', canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  this._placeholderTexture = tex;
  return tex;
};

/**
 * Videos are always muted + looping + autoplaying: browsers block unmuted
 * autoplay outright, and an ambient rotating billboard loop competing with
 * the game's own audio would be intrusive regardless. autoplay can still be
 * rejected in some browsers/embeds even when muted (e.g. data-saver modes)
 * — that failure is swallowed on purpose; the texture just stays on
 * whatever frame the video last had (its poster, or black) rather than
 * throwing into the caller.
 */
function buildVideoTexture(url) {
  const video = document.createElement('video');
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.crossOrigin = 'anonymous';
  video.play().catch((err) => {
    console.warn('[BillboardMedia] video autoplay was blocked for', url, err);
  });
  return new THREE.VideoTexture(video);
}

/**
 * "Contain" fit: composites the loaded image onto a canvas of the given
 * aspect ratio, scaled to fit fully inside without cropping or stretching,
 * centered, on a solid backing color. Without this a logo — square,
 * portrait, whatever its native shape — would just be stretched to fill
 * whatever rectangle it's applied to and read as smeared/distorted. Returns
 * the canvas texture immediately (blank, backing-colored) and repaints it
 * once the image has actually loaded, same lazy-upgrade shape as every
 * other async asset in this project (ModelCache, character.js's clips, ...).
 * Generic — knows nothing about billboards specifically, which is what lets
 * getImageTexture() below reuse it for anything else (e.g. a coin face)
 * that wants an image composited onto a fixed-aspect surface.
 */
function compositeContainTexture(url, aspect, backingColorHex, warnLabel) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(canvas.width / aspect);
  const ctx = canvas.getContext('2d');
  const backing = '#' + backingColorHex.toString(16).padStart(6, '0');

  function paintBacking() {
    ctx.fillStyle = backing;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  paintBacking();
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    // Scale to whichever axis is the tighter fit, so the whole image is
    // always visible — the other axis gets letterboxed with the backing
    // color rather than the image being cropped.
    let drawW, drawH;
    if (imgAspect > aspect) {
      drawW = canvas.width;
      drawH = drawW / imgAspect;
    } else {
      drawH = canvas.height;
      drawW = drawH * imgAspect;
    }
    paintBacking();
    ctx.drawImage(img, (canvas.width - drawW) / 2, (canvas.height - drawH) / 2, drawW, drawH);
    tex.needsUpdate = true;
  };
  img.onerror = (err) => {
    console.warn('[BillboardMedia] failed to load ' + (warnLabel || 'image') + ' creative', url, err);
  };
  img.src = url;

  return tex;
}

/** The only entry point billboard-placement code (runner.js) should use. */
BillboardMedia.getTexture = function (creative) {
  if (!creative || !creative.url) return this.getPlaceholder();
  const panel = RunnerTheme.BILLBOARD;
  const cacheKey = 'billboard|' + creative.url;
  if (this._cache[cacheKey]) return this._cache[cacheKey];
  const tex = creative.type === 'video'
    ? buildVideoTexture(creative.url)
    : compositeContainTexture(creative.url, panel.panelWidth / panel.panelHeight, panel.backingColor, 'billboard');
  this._cache[cacheKey] = tex;
  return tex;
};

/**
 * Generic image-only entry point for anything outside the billboard system
 * that wants a single contain-fit texture — e.g. brand.js's optional coin
 * face image. `aspect` is width/height of the target surface (1 for a
 * square/circular coin face); `backingColorHex` fills the letterboxed area,
 * pass the same color the surface would otherwise be (e.g.
 * RunnerBrand.collectibleColor) so a transparent-background logo blends in
 * rather than showing a mismatched backing rectangle. Cached separately
 * from billboard creatives (same url + different aspect/backing would
 * otherwise collide on one cache entry).
 */
BillboardMedia.getImageTexture = function (url, aspect, backingColorHex) {
  if (!url) return null;
  const cacheKey = 'image|' + url + '|' + aspect + '|' + backingColorHex;
  if (this._cache[cacheKey]) return this._cache[cacheKey];
  const tex = compositeContainTexture(url, aspect, backingColorHex, 'coin');
  this._cache[cacheKey] = tex;
  return tex;
};
