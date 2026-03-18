(() => {
  "use strict";

  // -----------------------
  // Assets
  // -----------------------
  const imageLinkList = ["image_89.jpg", "image_90.jpg", "image_91.jpg", "image_92.jpg"];
  const svgList = ["1904_25_89.svg", "1904_25_90.svg", "1904_25_91.svg", "1904_25_92.svg"];

  // -----------------------
  // State + annotation store
  // -----------------------
  const state = {
    currentIndex: 0,
    zoom: 3,
    annoMode: false,
    annoTarget: "image", // "image" | "layout"
    drawing: null        // { layer, x0, y0, rectEl }
  };

  // per page: { image: [...], layout: [...] }
  const annotations = {};

  // -----------------------
  // DOM
  // -----------------------
  const pageImage = document.getElementById("page-image");
  const magnifierWrap = document.getElementById("magnifier-wrap");

  const svgStage = document.getElementById("svg-stage");
  const layoutContainer = document.getElementById("layout-container");

  const annoImageLayer = document.getElementById("anno-image");
  const annoLayoutLayer = document.getElementById("anno-layout");

  const previousBtn = document.getElementById("previous");
  const nextBtn = document.getElementById("next");
  const pageButtonsWrap = document.getElementById("page-buttons");

  const toggleAnnoBtn = document.getElementById("toggle-anno");
  const annoTargetSelect = document.getElementById("anno-target");
  const exportBtn = document.getElementById("export-anno");
  const importBtn = document.getElementById("import-anno");
  const clearPageBtn = document.getElementById("clear-page");

  document.addEventListener("DOMContentLoaded", init);

  // -----------------------
  // Init
  // -----------------------
  function init() {
    buildPageButtons();

    previousBtn.addEventListener("click", () => goTo(state.currentIndex - 1));
    nextBtn.addEventListener("click", () => goTo(state.currentIndex + 1));

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") goTo(state.currentIndex - 1);
      if (e.key === "ArrowRight") goTo(state.currentIndex + 1);
      if (e.key === "Escape") setAnnoMode(false);
    });

    toggleAnnoBtn.addEventListener("click", () => setAnnoMode(!state.annoMode));
    annoTargetSelect.addEventListener("change", () => {
      state.annoTarget = annoTargetSelect.value;
      setAnnoMode(state.annoMode); // refresh active overlay
    });

    exportBtn.addEventListener("click", exportAnnotations);
    importBtn.addEventListener("click", importAnnotations);
    clearPageBtn.addEventListener("click", clearCurrentPageAnnotations);

    // magnifier + image overlay sizing
    pageImage.addEventListener("load", () => {
      magnify(pageImage, magnifierWrap, state.zoom);
      syncAnnoLayerToElement(annoImageLayer, pageImage);
      renderAnnotationsForPage(state.currentIndex);
    });

    // keep overlays correct on resize
    window.addEventListener("resize", () => {
      syncAnnoLayerToElement(annoImageLayer, pageImage);
      syncAnnoLayerToStage(annoLayoutLayer, svgStage);
      renderAnnotationsForPage(state.currentIndex);
    });

    // annotation interactions
    wireAnnoLayer(annoImageLayer, () => state.annoMode && state.annoTarget === "image");
    wireAnnoLayer(annoLayoutLayer, () => state.annoMode && state.annoTarget === "layout");

    goTo(0);
  }

  // -----------------------
  // Navigation
  // -----------------------
  function buildPageButtons() {
    pageButtonsWrap.innerHTML = "";
    for (let i = 0; i < imageLinkList.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `button-${i + 1}`;
      btn.textContent = String(i + 1);
      btn.style.width = "45px";
      btn.addEventListener("click", () => goTo(i));
      pageButtonsWrap.appendChild(btn);
    }
  }

  async function goTo(index) {
    if (index < 0 || index >= imageLinkList.length) return;

    state.currentIndex = index;
    updateButtons();

    // set image (image load event will sync image overlay + magnifier)
    pageImage.src = imageLinkList[index];

    // set layout svg
    await fetchAndRenderSVG(index);

    // sync layout annotation overlay size to the rendered stage
    // (layout container is position:relative so overlay will align)
    syncAnnoLayerToStage(annoLayoutLayer, svgStage);

    // render annotations for this page
    renderAnnotationsForPage(index);
  }

  function updateButtons() {
    const all = pageButtonsWrap.querySelectorAll("button");
    all.forEach((b, i) => b.classList.toggle("button-clicked", i === state.currentIndex));

    previousBtn.disabled = state.currentIndex === 0;
    nextBtn.disabled = state.currentIndex === imageLinkList.length - 1;
  }

  // -----------------------
  // Annotation mode handling (also disables magnifier)
  // -----------------------
  function setAnnoMode(on) {
    state.annoMode = on;
    toggleAnnoBtn.classList.toggle("button-clicked", on);

    annoImageLayer.classList.toggle("active", on && state.annoTarget === "image");
    annoLayoutLayer.classList.toggle("active", on && state.annoTarget === "layout");

    // hide magnifier lens while annotating
    magnifierWrap.classList.toggle("magnifier-off", on);
  }

  // -----------------------
  // Layout SVG loading + restore cropped images
  // -----------------------
  async function fetchAndRenderSVG(i) {
    const response = await fetch(svgList[i]);
    const text = await response.text();

    svgStage.innerHTML = text;

    const svg = svgStage.querySelector("svg");
    if (!svg) return;

    // Restore your "cropped images":
    // for each <rect class="image" path="..."> inject an <image href="...">.
    const imageRects = [...svg.querySelectorAll("rect.image")];
    for (const r of imageRects) injectSvgImageForRect(svg, r);
  }

  function injectSvgImageForRect(svg, rect) {
    const path = rect.getAttribute("path");
    if (!path) return;

    const svgImage = document.createElementNS("http://www.w3.org/2000/svg", "image");
    svgImage.setAttribute("href", path); // SVG2
    svgImage.setAttribute("x", rect.getAttribute("x"));
    svgImage.setAttribute("y", rect.getAttribute("y"));
    svgImage.setAttribute("width", rect.getAttribute("width"));
    svgImage.setAttribute("height", rect.getAttribute("height"));

    // Important: do not block hover/click on underlying layout shapes
    svgImage.style.pointerEvents = "none";

    svg.appendChild(svgImage);
  }

  // -----------------------
  // Annotation data model
  // -----------------------
  function getPageBucket(pageIdx) {
    if (!annotations[pageIdx]) annotations[pageIdx] = { image: [], layout: [] };
    return annotations[pageIdx];
  }

  // -----------------------
  // Annotation interactions
  // -----------------------
  function wireAnnoLayer(layer, isEnabledFn) {
    layer.addEventListener("mousedown", (e) => {
      if (!isEnabledFn()) return;
      const p = cursorToSvgPoint(layer, e);

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.classList.add("anno-rect");
      rect.setAttribute("x", p.x);
      rect.setAttribute("y", p.y);
      rect.setAttribute("width", 1);
      rect.setAttribute("height", 1);
      layer.appendChild(rect);

      state.drawing = { layer, x0: p.x, y0: p.y, rectEl: rect };
    });

    layer.addEventListener("mousemove", (e) => {
      if (!isEnabledFn() || !state.drawing || state.drawing.layer !== layer) return;

      const p = cursorToSvgPoint(layer, e);
      const x = Math.min(state.drawing.x0, p.x);
      const y = Math.min(state.drawing.y0, p.y);
      const w = Math.abs(p.x - state.drawing.x0);
      const h = Math.abs(p.y - state.drawing.y0);

      state.drawing.rectEl.setAttribute("x", x);
      state.drawing.rectEl.setAttribute("y", y);
      state.drawing.rectEl.setAttribute("width", w);
      state.drawing.rectEl.setAttribute("height", h);
    });

    layer.addEventListener("mouseup", () => finishDrawing(layer, isEnabledFn));
    layer.addEventListener("mouseleave", () => finishDrawing(layer, isEnabledFn));
  }

  function finishDrawing(layer, isEnabledFn) {
    if (!isEnabledFn() || !state.drawing || state.drawing.layer !== layer) return;

    const rect = state.drawing.rectEl;
    state.drawing = null;

    const w = parseFloat(rect.getAttribute("width"));
    const h = parseFloat(rect.getAttribute("height"));

    if (w < 8 || h < 8) {
      rect.remove();
      return;
    }

    const text = prompt("Annotation text:");
    if (!text) {
      rect.remove();
      return;
    }

    const target = (layer.id === "anno-image") ? "image" : "layout";
    const pageIdx = state.currentIndex;
    const bucket = getPageBucket(pageIdx);

    bucket[target].push({
      id: (crypto.randomUUID?.() ?? String(Date.now() + Math.random())),
      x: parseFloat(rect.getAttribute("x")),
      y: parseFloat(rect.getAttribute("y")),
      width: w,
      height: h,
      text
    });

    renderAnnotationsForPage(pageIdx);
  }

  function renderAnnotationsForPage(pageIdx) {
    annoImageLayer.innerHTML = "";
    annoLayoutLayer.innerHTML = "";

    const bucket = getPageBucket(pageIdx);

    renderIntoLayer(annoImageLayer, bucket.image, "image");
    renderIntoLayer(annoLayoutLayer, bucket.layout, "layout");

    // keep correct active overlay + magnifier state
    setAnnoMode(state.annoMode);
  }

  function renderIntoLayer(layer, list, target) {
    for (const a of list) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.classList.add("anno-rect");
      rect.dataset.id = a.id;
      rect.setAttribute("x", a.x);
      rect.setAttribute("y", a.y);
      rect.setAttribute("width", a.width);
      rect.setAttribute("height", a.height);

      // click to edit/delete (only in annotate mode AND correct target)
      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!state.annoMode || state.annoTarget !== target) return;

        const choice = prompt("Edit text (empty = delete):", a.text);
        if (choice === null) return;

        const bucket = getPageBucket(state.currentIndex);
        if (choice.trim() === "") {
          bucket[target] = bucket[target].filter(x => x.id !== a.id);
        } else {
          a.text = choice;
        }
        renderAnnotationsForPage(state.currentIndex);
      });

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.classList.add("anno-label");
      label.setAttribute("x", a.x + 6);
      label.setAttribute("y", a.y + 16);
      label.textContent = a.text;

      layer.appendChild(rect);
      layer.appendChild(label);
    }
  }

  // -----------------------
  // Export / import
  // -----------------------
  function exportAnnotations() {
    const payload = {
      schema: "modeundheim-annotations-v1",
      createdAt: new Date().toISOString(),
      pages: annotations
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "annotations.json";
    a.click();

    URL.revokeObjectURL(url);
  }

  function importAnnotations() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data || !data.pages) {
          alert("Invalid JSON: missing 'pages'.");
          return;
        }

        // replace in-memory store
        for (const k of Object.keys(annotations)) delete annotations[k];
        for (const [pageIdx, bucket] of Object.entries(data.pages)) {
          annotations[Number(pageIdx)] = {
            image: Array.isArray(bucket.image) ? bucket.image : [],
            layout: Array.isArray(bucket.layout) ? bucket.layout : []
          };
        }

        renderAnnotationsForPage(state.currentIndex);
      } catch (err) {
        alert("Failed to import JSON.");
        console.error(err);
      }
    };

    input.click();
  }

  function clearCurrentPageAnnotations() {
    if (!confirm("Clear annotations for this page?")) return;
    annotations[state.currentIndex] = { image: [], layout: [] };
    renderAnnotationsForPage(state.currentIndex);
  }

  // -----------------------
  // Overlay sizing helpers
  // -----------------------
  function syncAnnoLayerToElement(layer, el) {
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    layer.setAttribute("viewBox", `0 0 ${w} ${h}`);
    layer.setAttribute("preserveAspectRatio", "none");
  }

  function syncAnnoLayerToStage(layer, stageEl) {
    const rect = stageEl.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    layer.setAttribute("viewBox", `0 0 ${w} ${h}`);
    layer.setAttribute("preserveAspectRatio", "none");

    // Make sure the overlay sits exactly on top of the stage
    // (layout-container is position:relative, anno-layer uses inset:0)
    layer.style.inset = "0";
  }

  function cursorToSvgPoint(svgEl, e) {
    const ev = e.touches ? e.touches[0] : e;
    const pt = svgEl.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = svgEl.getScreenCTM();
    return pt.matrixTransform(ctm.inverse());
  }

  // -----------------------
  // Magnifier (no duplicates)
  // -----------------------
  function magnify(imgEl, wrapEl, zoom) {
    // remove old lens if it exists
    const old = wrapEl.querySelector(".img-magnifier-glass");
    if (old) old.remove();

    const glass = document.createElement("div");
    glass.className = "img-magnifier-glass";
    wrapEl.insertBefore(glass, imgEl);

    glass.style.backgroundImage = `url('${imgEl.src}')`;
    glass.style.backgroundRepeat = "no-repeat";
    glass.style.backgroundSize = `${imgEl.clientWidth * zoom}px ${imgEl.clientHeight * zoom}px`;

    const bw = 3;
    const w = glass.offsetWidth / 2;
    const h = glass.offsetHeight / 2;

    const move = (e) => {
      // If annotate mode is on, do nothing
      if (state.annoMode) return;

      e.preventDefault();
      const pos = getCursorPos(e, imgEl);
      let x = pos.x;
      let y = pos.y;

      const maxX = imgEl.clientWidth - (w / zoom);
      const maxY = imgEl.clientHeight - (h / zoom);

      if (x > maxX) x = maxX;
      if (x < w / zoom) x = w / zoom;
      if (y > maxY) y = maxY;
      if (y < h / zoom) y = h / zoom;

      glass.style.left = (x - w) + "px";
      glass.style.top = (y - h) + "px";
      glass.style.backgroundPosition =
        `-${(x * zoom) - w + bw}px -${(y * zoom) - h + bw}px`;
    };

    imgEl.onmousemove = move;
    glass.onmousemove = move;
    imgEl.ontouchmove = move;
    glass.ontouchmove = move;
  }

  function getCursorPos(e, imgEl) {
    const ev = e.touches ? e.touches[0] : e;
    const a = imgEl.getBoundingClientRect();
    const x = ev.clientX - a.left;
    const y = ev.clientY - a.top;
    return { x, y };
  }
})();