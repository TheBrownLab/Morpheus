// ── app.js — Amoeba Morphometrics Pipeline frontend ─────────────────────────
// ES module, no build step required.

const API = "";  // same origin

// ── Shared state ──────────────────────────────────────────────────────────────
const state = {
  config: { strains: [], analyses: [] },
  currentAnalysis: null,
  availableMeasurements: [],
  objectives: [],

  // Curation state
  curationImages: [],             // [{idx, strain, filename, filepath, n_cells}]
  currentCurateIdx: 0,
  currentCurateData: null,        // full image curation data
  strainFirstIdx: {},             // strain -> first image idx
  strainNames: [],
  currentImgNaturalW: 1,
  currentImgNaturalH: 1,
  viewerScale: 1,
  viewerOffsetX: 0,
  viewerOffsetY: 0,
};

// ── Objectives (microscope presets) ───────────────────────────────────────────

async function loadObjectives() {
  try {
    state.objectives = await apiJSON("/api/objectives");
  } catch (e) {
    state.objectives = [];
  }
  renderObjectivesList();
  populateObjectiveSelect();
}

async function saveObjectives() {
  try {
    await postJSON("/api/objectives/save", { objectives: state.objectives });
  } catch (e) { showError(e.message); }
}

function renderObjectivesList() {
  const container = document.getElementById("objectives-list");
  if (!container) return;
  if (!state.objectives.length) {
    container.innerHTML = '<p class="empty-state">No objectives configured. Add manually or load a Fiji profile.</p>';
    return;
  }
  container.innerHTML = "";
  state.objectives.forEach((obj, i) => {
    const row = document.createElement("div");
    row.className = "obj-row";
    row.innerHTML = `
      <span class="obj-name">${obj.name}</span>
      <span class="obj-px">${obj.pixel_um} µm/px</span>
      <button class="btn-danger btn-sm obj-del-btn" data-i="${i}">×</button>
    `;
    row.querySelector(".obj-del-btn").addEventListener("click", async () => {
      state.objectives.splice(i, 1);
      await saveObjectives();
      renderObjectivesList();
      populateObjectiveSelect();
    });
    container.appendChild(row);
  });
}

function populateObjectiveSelect() {
  const sel = document.getElementById("new-analysis-objective-select");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— pick objective or enter below —</option>';
  state.objectives.forEach(obj => {
    const opt = document.createElement("option");
    opt.value = obj.pixel_um;
    opt.textContent = `${obj.name}  (${obj.pixel_um} µm/px)`;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function initObjectives() {
  document.getElementById("show-add-objective-btn")?.addEventListener("click", () => {
    document.getElementById("add-objective-form").classList.remove("hidden");
  });
  document.getElementById("add-objective-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("add-objective-form").classList.add("hidden");
  });

  document.getElementById("add-objective-confirm-btn")?.addEventListener("click", async () => {
    const name     = document.getElementById("new-obj-name").value.trim();
    const pixelRaw = document.getElementById("new-obj-pixel-um").value.trim();
    if (!name || !pixelRaw) { alert("Enter both a name and a pixel size."); return; }
    const pixel_um = parseFloat(pixelRaw);
    if (isNaN(pixel_um) || pixel_um <= 0) { alert("Invalid pixel size."); return; }
    state.objectives.push({ name, pixel_um });
    await saveObjectives();
    document.getElementById("new-obj-name").value = "";
    document.getElementById("new-obj-pixel-um").value = "";
    document.getElementById("add-objective-form").classList.add("hidden");
    renderObjectivesList();
    populateObjectiveSelect();
  });

  // Parse a Fiji profile file (txt or json) → [{name, pixel_um}]
  function parseFijiProfile(text, filename) {
    if (filename.endsWith(".txt")) {
      // Format: repeating groups of 4 <val> tags
      // group[0] = objective name, group[1] = distance_px, group[2] = known_um, group[3] = scalebar (ignored)
      // pixel_um = known_um / distance_px
      const vals = [...text.matchAll(/<val>([^<]+)<\/val>/g)].map(m => m[1].trim());
      const parsed = [];
      for (let i = 0; i + 3 < vals.length; i += 4) {
        const name     = vals[i];
        const dist_px  = parseFloat(vals[i + 1]);
        const known_um = parseFloat(vals[i + 2]);
        if (!name || isNaN(dist_px) || isNaN(known_um) || dist_px === 0) continue;
        parsed.push({ name, pixel_um: parseFloat((known_um / dist_px).toFixed(6)) });
      }
      return parsed;
    } else {
      // JSON format: {objectives:[{name,pixel_um},...]} or array
      const data = JSON.parse(text);
      const rawList = Array.isArray(data) ? data : (data.objectives || data.Objectives || []);
      return rawList.map(o => ({
        name:     o.name || o.label || o.Name || "Unknown",
        pixel_um: parseFloat(o.pixel_um ?? o.pixel_size_um ?? o.pixelSize ?? o.pixel ?? 0),
      })).filter(o => o.pixel_um > 0);
    }
  }

  async function importFijiFile(file) {
    try {
      const text = await file.text();
      const parsed = parseFijiProfile(text, file.name.toLowerCase());
      if (!parsed.length) { alert("No objectives found in " + file.name); return; }
      const existing = new Set(state.objectives.map(o => o.name));
      let added = 0;
      parsed.forEach(o => { if (!existing.has(o.name)) { state.objectives.push(o); added++; } });
      await saveObjectives();
      renderObjectivesList();
      populateObjectiveSelect();
      alert(`Loaded ${parsed.length} objective(s) from ${file.name}${added < parsed.length ? ` (${parsed.length - added} duplicate(s) skipped)` : ""}`);
    } catch (err) {
      alert("Could not parse profile: " + err.message);
    }
  }

  // File input upload
  document.getElementById("fiji-profile-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await importFijiFile(file);
    e.target.value = "";
  });

  // Drag-and-drop onto the objectives card
  const dropZone = document.getElementById("objectives-drop-zone");
  const dropHint = document.getElementById("objectives-drop-hint");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drop-active");
    });
    dropZone.addEventListener("dragleave", (e) => {
      if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove("drop-active");
    });
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove("drop-active");
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.name.match(/\.(txt|json)$/i)) { alert("Drop a .txt or .json Fiji profile."); return; }
      await importFijiFile(file);
    });
  }

  // When user picks an objective in the analysis form, fill pixel size field
  document.getElementById("new-analysis-objective-select")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const pixelInput = document.getElementById("new-analysis-pixel-size");
    if (val && pixelInput) { pixelInput.value = val; updateAreaHints(); }
  });

  // Live µm² conversion on area inputs and pixel size changes
  function updateAreaHints() {
    const px = parseFloat(document.getElementById("new-analysis-pixel-size")?.value) || 0;
    const minPx = parseInt(document.getElementById("new-analysis-min-area")?.value) || 0;
    const maxPx = parseInt(document.getElementById("new-analysis-max-area")?.value) || 0;
    const minHint = document.getElementById("min-area-hint");
    const maxHint = document.getElementById("max-area-hint");
    if (px > 0) {
      const px2 = px * px;
      if (minHint) minHint.textContent = `≈ ${(minPx * px2).toFixed(1)} µm²`;
      if (maxHint) maxHint.textContent = `≈ ${(maxPx * px2).toFixed(1)} µm²`;
    } else {
      if (minHint) minHint.textContent = "set pixel size for µm²";
      if (maxHint) maxHint.textContent = "";
    }
  }

  document.getElementById("new-analysis-min-area")?.addEventListener("input", updateAreaHints);
  document.getElementById("new-analysis-max-area")?.addEventListener("input", updateAreaHints);
  document.getElementById("new-analysis-pixel-size")?.addEventListener("input", updateAreaHints);
  updateAreaHints();
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Two-stage confirmation on a button — avoids browser confirm() which can be
 * silently blocked after the user checks "prevent further dialogs".
 * First click turns the button red with a label, second click within timeoutMs
 * resolves the promise. Any other click or timeout rejects.
 */
function confirmBtn(btn, label = "Confirm?", timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const origText = btn.textContent;
    const origClass = btn.className;
    btn.textContent = label;
    btn.classList.add("btn-danger");
    btn.classList.remove("btn-secondary", "btn-primary");

    let resolved = false;
    const reset = () => {
      if (resolved) return;
      resolved = true;
      btn.textContent = origText;
      btn.className = origClass;
    };

    const timer = setTimeout(() => { reset(); reject(new Error("timeout")); }, timeoutMs);

    const onClick = () => {
      clearTimeout(timer);
      btn.removeEventListener("click", onClick);
      reset();
      resolve();
    };
    btn.addEventListener("click", onClick);

    // If user clicks anywhere else, cancel
    const onBlur = (e) => {
      if (!btn.contains(e.target)) {
        clearTimeout(timer);
        btn.removeEventListener("click", onClick);
        document.removeEventListener("click", onBlur, true);
        reset();
        reject(new Error("cancelled"));
      }
    };
    // Delay attaching blur-cancel so this click doesn't immediately cancel
    setTimeout(() => document.addEventListener("click", onBlur, true), 50);
  });
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, options);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${msg}`);
  }
  return res;
}

async function apiJSON(path, options = {}) {
  const res = await apiFetch(path, options);
  return res.json();
}

function postJSON(path, body) {
  return apiJSON(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq(path) {
  return apiJSON(path, { method: "DELETE" });
}

function encodedPath(p) {
  return encodeURIComponent(p);
}

function showError(msg) {
  console.error(msg);
  alert("Error: " + msg);
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Tab navigation ─────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  switchTab("setup");
}

function switchTab(tab) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.remove("hidden");
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (btn) btn.classList.add("active");

  if (tab === "select")  onSelectTabLoad();
  if (tab === "train")   onTrainTabLoad();
  if (tab === "measure") onMeasureTabLoad();
  if (tab === "curate")  onCurateTabLoad();
  if (tab === "results") onResultsTabLoad();
}

// ── Analysis selector (shared across tabs) ────────────────────────────────────

function populateAnalysisSelects() {
  const analyses = state.config.analyses || [];
  document.querySelectorAll(".analysis-select").forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">— select analysis —</option>';
    analyses.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
    if (!sel.value && analyses.length > 0) sel.value = analyses[0].id;
    if (state.currentAnalysis) sel.value = state.currentAnalysis;
  });
}

function getSelectedAnalysis(tabSuffix) {
  const sel = document.getElementById(`analysis-select-${tabSuffix}`);
  return sel ? sel.value : (state.currentAnalysis || "");
}

// ── Setup tab ─────────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    state.config = await apiJSON("/api/config");
  } catch (e) {
    console.warn("Could not load config:", e.message);
  }
}

async function loadModels(selectId = null) {
  try {
    const data = await apiJSON("/api/models");
    const models = data.models || [];
    const targets = selectId ? [selectId] : ["new-analysis-model"];
    targets.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '<option value="">— select model —</option>';
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.path;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  } catch (e) {
    console.warn("Could not load models:", e.message);
  }
}

async function loadAvailableMeasurements() {
  try {
    state.availableMeasurements = await apiJSON("/api/measurements/available");
    renderMeasurementChecklist();
  } catch (e) {
    console.warn("Could not load measurements:", e.message);
    document.getElementById("measurement-checklist").innerHTML =
      '<span class="text-red-400 text-xs">Could not load measurements — is the morpheus environment active?</span>';
  }
}

function renderMeasurementChecklist(selectedNames = null) {
  const container = document.getElementById("measurement-checklist");
  if (!container) return;
  const defaultSelected = [
    "length_um", "breadth_um", "aspect_ratio", "area_um2",
    "feret_max_um", "feret_min_um", "feret_aspect_ratio", "solidity", "perimeter_um",
  ];
  const active = selectedNames || defaultSelected;
  container.innerHTML = state.availableMeasurements.map(m => `
    <label class="flex items-center gap-1.5 cursor-pointer hover:text-white py-0.5">
      <input type="checkbox" class="meas-check accent-emerald-500"
        data-name="${m.name}" ${active.includes(m.name) ? "checked" : ""} />
      <span title="${m.description || ""}">${m.name}</span>
      ${m.unit ? `<span class="text-gray-600">(${m.unit})</span>` : ""}
    </label>
  `).join("");
}

function getCheckedMeasurements() {
  return Array.from(document.querySelectorAll(".meas-check:checked")).map(el => el.dataset.name);
}

function renderStrainCard(strain) {
  const el = document.createElement("div");
  el.className = "strain-card";
  el.innerHTML = `
    <div class="strain-dot" style="background:${strain.color || "#4ade80"}"></div>
    <div class="strain-info">
      <div class="strain-name-row">
        <span class="strain-name">${strain.name}</span>
        <span id="ome-badge-${CSS.escape(strain.name)}"></span>
      </div>
      <div class="strain-dir" title="${strain.source_dir}">${strain.source_dir || "No source directory"}</div>
      <div class="strain-counts">
        <span id="strain-status-${strain.name}">${strain.source_count ?? "?"} in source · ${strain.imported_count ?? 0} imported</span>
        <span id="strain-import-count-${strain.name}" class="strain-counter hidden"></span>
      </div>
    </div>
    <button class="btn-primary btn-sm import-strain-btn" data-name="${strain.name}">Import</button>
    <button class="btn-danger btn-sm delete-strain-btn" data-name="${strain.name}">Remove</button>
  `;
  el.querySelector(".import-strain-btn").addEventListener("click", () => importStrain(strain.name));
  el.querySelector(".delete-strain-btn").addEventListener("click", () => deleteStrain(strain.name));
  // Async OME check — only fires if strain has imported images
  if (strain.imported_count > 0) {
    const badgeSlot = el.querySelector(`#ome-badge-${CSS.escape(strain.name)}`);
    if (badgeSlot) fetchOmeBadge(strain.name, badgeSlot);
  }
  return el;
}

function renderAnalysisCard(analysis) {
  const el = document.createElement("div");
  el.className = "analysis-card";

  const measureChips = (analysis.measurements || []).slice(0, 6)
    .map(m => `<span class="chip chip--dim">${m}</span>`).join(" ");
  const more = (analysis.measurements || []).length > 6
    ? `<span class="text-dim" style="font-size:10px">+${(analysis.measurements || []).length - 6} more</span>` : "";
  const modelName = analysis.model_path ? analysis.model_path.split("/").pop() : "—";

  // Build model options for the edit form
  const modelOpts = Array.from(document.getElementById("new-analysis-model")?.options || [])
    .filter(o => o.value)
    .map(o => `<option value="${o.value}" ${analysis.model_path === o.value ? "selected" : ""}>${o.textContent.trim()}</option>`)
    .join("");

  // Build measurement checklist for edit form
  const ALL_MEASUREMENTS = [
    "length_um","breadth_um","aspect_ratio","area_um2",
    "feret_max_um","feret_min_um","feret_aspect_ratio",
    "solidity","perimeter_um",
  ];
  const measChecks = ALL_MEASUREMENTS.map(m => {
    const checked = (analysis.measurements || []).includes(m) ? "checked" : "";
    return `<label class="meas-check-label"><input type="checkbox" value="${m}" ${checked} class="edit-meas-cb"> ${m}</label>`;
  }).join("");

  el.innerHTML = `
    <div class="analysis-card-top">
      <div class="analysis-card-info">
        <div class="analysis-card-title">
          <span class="analysis-name">${analysis.name}</span>
          <span class="analysis-id">${analysis.id}</span>
        </div>
        <div class="analysis-model-row">Default model: <strong>${modelName}</strong></div>
        <div class="analysis-chips">${measureChips}${more}</div>
        <div class="analysis-params">
          min: ${analysis.min_area} px² · max: ${analysis.max_area} px² ·
          ⌀ ${analysis.diameter ?? "auto"} · ${analysis.pixel_size_um ?? "—"} µm/px
        </div>
      </div>
      <div class="analysis-card-actions">
        <button class="btn-secondary btn-sm edit-analysis-btn">Edit</button>
        <button class="btn-secondary btn-sm toggle-strain-models-btn">Strain Models</button>
        <button class="btn-danger btn-sm delete-analysis-btn" data-id="${analysis.id}">Delete</button>
      </div>
    </div>

    <!-- Inline edit form (hidden by default) -->
    <div class="analysis-edit-form hidden">
      <div class="form-grid">
        <div class="field">
          <label>Name</label>
          <input class="edit-name" type="text" value="${analysis.name}" />
        </div>
        <div class="field">
          <label>Model</label>
          <select class="edit-model">
            <option value="">— none —</option>
            ${modelOpts}
          </select>
        </div>
        <div class="field">
          <label>Diameter px</label>
          <input class="edit-diameter" type="number" step="1" placeholder="auto" value="${analysis.diameter ?? ""}" />
        </div>
        <div class="field">
          <label>Min area (px²)</label>
          <input class="edit-min-area" type="number" value="${analysis.min_area ?? 300}" />
          <span class="area-hint edit-min-hint"></span>
        </div>
        <div class="field">
          <label>Max area (px²)</label>
          <input class="edit-max-area" type="number" value="${analysis.max_area ?? 500000}" />
          <span class="area-hint edit-max-hint"></span>
        </div>
        <div class="field">
          <label>Pixel size µm/px</label>
          <input class="edit-pixel-size" type="number" step="any" value="${analysis.pixel_size_um ?? ""}" placeholder="e.g. 0.1075" />
        </div>
      </div>
      <div class="field" style="margin-top:6px">
        <label>Measurements</label>
        <div class="meas-grid">${measChecks}</div>
      </div>
      <div class="form-actions" style="margin-top:8px">
        <button class="btn-primary btn-sm save-analysis-btn">Save</button>
        <button class="btn-secondary btn-sm cancel-edit-btn">Cancel</button>
      </div>
    </div>

    <div class="strain-models-panel hidden">
      <div class="strain-models-header">
        Per-strain model overrides <span class="text-dim" style="font-size:10px">— leave blank to use default</span>
      </div>
      <div class="strain-models-list"></div>
    </div>
  `;

  // Edit toggle
  const editForm = el.querySelector(".analysis-edit-form");
  el.querySelector(".edit-analysis-btn").addEventListener("click", () => {
    editForm.classList.toggle("hidden");
    updateEditHints(el, analysis.pixel_size_um);
  });
  el.querySelector(".cancel-edit-btn").addEventListener("click", () => editForm.classList.add("hidden"));

  // Live µm² hints in edit form
  function updateEditHints(root, fallbackPx) {
    const px = parseFloat(root.querySelector(".edit-pixel-size")?.value) || parseFloat(fallbackPx) || 0;
    const minPx = parseInt(root.querySelector(".edit-min-area")?.value) || 0;
    const maxPx = parseInt(root.querySelector(".edit-max-area")?.value) || 0;
    const minH = root.querySelector(".edit-min-hint");
    const maxH = root.querySelector(".edit-max-hint");
    if (px > 0) {
      if (minH) minH.textContent = `≈ ${(minPx * px * px).toFixed(1)} µm²`;
      if (maxH) maxH.textContent = `≈ ${(maxPx * px * px).toFixed(1)} µm²`;
    } else {
      if (minH) minH.textContent = "set pixel size for µm²";
      if (maxH) maxH.textContent = "";
    }
  }
  el.querySelector(".edit-min-area")?.addEventListener("input",   () => updateEditHints(el, analysis.pixel_size_um));
  el.querySelector(".edit-max-area")?.addEventListener("input",   () => updateEditHints(el, analysis.pixel_size_um));
  el.querySelector(".edit-pixel-size")?.addEventListener("input", () => updateEditHints(el, null));

  // Save
  el.querySelector(".save-analysis-btn").addEventListener("click", async () => {
    const name      = el.querySelector(".edit-name").value.trim();
    const model     = el.querySelector(".edit-model").value;
    const diameter  = el.querySelector(".edit-diameter").value;
    const min_area  = parseInt(el.querySelector(".edit-min-area").value) || 300;
    const max_area  = parseInt(el.querySelector(".edit-max-area").value) || 500000;
    const pixel_size_um = parseFloat(el.querySelector(".edit-pixel-size").value) || null;
    const measurements = [...el.querySelectorAll(".edit-meas-cb:checked")].map(cb => cb.value);

    if (!name) { alert("Name is required"); return; }
    try {
      const updated = await apiFetch(`/api/analyses/${encodeURIComponent(analysis.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          model_path:    model || "",
          diameter:      diameter ? parseInt(diameter) : null,
          min_area, max_area, pixel_size_um, measurements,
        }),
      }).then(r => r.json());

      // Merge updates into local state and re-render
      Object.assign(analysis, updated);
      const idx = (state.config.analyses || []).findIndex(a => a.id === analysis.id);
      if (idx >= 0) state.config.analyses[idx] = updated;
      const newCard = renderAnalysisCard(updated);
      el.replaceWith(newCard);
      populateAnalysisSelects();
    } catch (e) { showError(e.message); }
  });

  el.querySelector(".delete-analysis-btn").addEventListener("click", () => deleteAnalysis(analysis.id));

  const panel = el.querySelector(".strain-models-panel");
  el.querySelector(".toggle-strain-models-btn").addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) renderStrainModelRows(panel, analysis);
  });

  return el;
}

function renderStrainModelRows(panel, analysis) {
  const list = panel.querySelector(".strain-models-list");
  const strains = state.config.strains || [];
  const strainModels = analysis.strain_models || {};
  const models = Array.from(document.getElementById("new-analysis-model")?.options || [])
    .filter(o => o.value).map(o => ({ path: o.value, name: o.textContent.trim() }));

  if (strains.length === 0) {
    list.innerHTML = '<p class="empty-state">No strains configured — add strains in Setup first.</p>';
    return;
  }

  list.innerHTML = strains.map(s => {
    const current = strainModels[s.name] || "";
    const opts = models.map(m =>
      `<option value="${m.path}" ${current === m.path ? "selected" : ""}>${m.name}</option>`
    ).join("");
    return `
      <div class="strain-model-row">
        <span class="strain-model-name">${s.name}</span>
        <select class="strain-model-select" data-strain="${s.name}">
          <option value="">Use default</option>
          ${opts}
        </select>
      </div>
    `;
  }).join("");

  // Save on any change
  list.querySelectorAll(".strain-model-select").forEach(sel => {
    sel.addEventListener("change", () => saveStrainModels(panel, analysis));
  });
}

async function saveStrainModels(panel, analysis) {
  const strain_models = {};
  panel.querySelectorAll(".strain-model-select").forEach(sel => {
    if (sel.value) strain_models[sel.dataset.strain] = sel.value;
  });
  try {
    const updated = await apiFetch(`/api/analyses/${encodeURIComponent(analysis.id)}/strain-models`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strain_models }),
    }).then(r => r.json());
    analysis.strain_models = updated.strain_models;
    // Update in state
    const idx = (state.config.analyses || []).findIndex(a => a.id === analysis.id);
    if (idx >= 0) state.config.analyses[idx].strain_models = updated.strain_models;
  } catch (e) { showError(e.message); }
}

async function loadStrains() {
  try {
    const strains = await apiJSON("/api/config/strain/status");
    const container = document.getElementById("strains-list");
    if (!container) return;
    if (strains.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500">No strains configured yet.</p>';
      return;
    }
    container.innerHTML = "";
    strains.forEach(s => container.appendChild(renderStrainCard(s)));
  } catch (e) {
    console.warn("loadStrains error:", e.message);
  }
}

async function loadAnalyses() {
  const analyses = state.config.analyses || [];
  const container = document.getElementById("analyses-list");
  if (!container) return;
  if (analyses.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500">No analyses configured yet.</p>';
    return;
  }
  container.innerHTML = "";
  analyses.forEach(a => container.appendChild(renderAnalysisCard(a)));
}

async function importStrain(name) {
  const statusEl  = document.getElementById(`strain-status-${name}`);
  const countEl   = document.getElementById(`strain-import-count-${name}`);
  const importBtn = document.querySelector(`.import-strain-btn[data-name="${name}"]`);

  if (importBtn) { importBtn.disabled = true; importBtn.textContent = "Importing…"; }
  if (statusEl)  statusEl.textContent = "Scanning…";
  if (countEl)   { countEl.textContent = ""; countEl.classList.remove("hidden"); }

  try {
    const evtSource = new EventSource(`/api/config/strain/import/${encodeURIComponent(name)}/stream`);
    evtSource.onmessage = async (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }

      if (d.total === 0 && d.status === "starting") {
        if (statusEl) statusEl.textContent = "No images found in source directory.";
        if (countEl)  countEl.textContent = "";
        evtSource.close();
        if (importBtn) { importBtn.disabled = false; importBtn.textContent = "Import"; }
        return;
      }

      if (d.status === "copying" || d.status === "starting") {
        if (countEl)  countEl.textContent = `${d.copied} / ${d.total}`;
        if (statusEl) statusEl.textContent = d.filename ? `Copying ${d.filename}` : "Starting…";
      }

      if (d.status === "done") {
        evtSource.close();
        if (countEl)  countEl.textContent = `${d.copied} / ${d.total}`;
        if (statusEl) statusEl.textContent =
          `${d.copied} imported` + (d.errors?.length ? ` · ${d.errors.length} errors` : "");
        if (importBtn) { importBtn.disabled = false; importBtn.textContent = "Import"; }
        await loadStrains();
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      if (statusEl) statusEl.textContent = "Import error — check server logs.";
      if (importBtn) { importBtn.disabled = false; importBtn.textContent = "Import"; }
    };
  } catch (e) {
    if (statusEl) statusEl.textContent = `Error: ${e.message}`;
    if (importBtn) { importBtn.disabled = false; importBtn.textContent = "Import"; }
  }
}

async function deleteStrain(name) {
  const btn = document.querySelector(`.delete-strain-btn[data-name="${name}"]`);
  if (btn) { try { await confirmBtn(btn, "Remove — sure?"); } catch { return; } }
  try {
    await deleteReq(`/api/config/strain/${encodeURIComponent(name)}`);
    state.config = await apiJSON("/api/config");
    await loadStrains();
    populateAnalysisSelects();
    await refreshSetStatus();
  } catch (e) { showError(e.message); }
}

async function deleteAnalysis(id) {
  const btn = document.querySelector(`.delete-analysis-btn[data-id="${id}"]`);
  if (btn) { try { await confirmBtn(btn, "Delete — sure?"); } catch { return; } }
  try {
    await deleteReq(`/api/analyses/${encodeURIComponent(id)}`);
    state.config = await apiJSON("/api/config");
    await loadAnalyses();
    populateAnalysisSelects();
  } catch (e) { showError(e.message); }
}

// ── Environment check ─────────────────────────────────────────────────────────

const PKG_REQUIRED = ["cellpose","napari","tifffile","pandas","numpy","scikit-image"];
const PKG_OPTIONAL = ["matplotlib","fastapi","uvicorn"];

async function loadEnvStatus() {
  setEnvLight("checking");
  try {
    const data = await apiJSON("/api/env/status");
    renderEnvStatus(data);
  } catch (e) {
    setEnvLight("error");
  }
}

function setEnvLight(state) {
  const el = document.getElementById("env-light");
  if (!el) return;
  el.className = `env-light env-light--${state}`;
  el.title = { ok:"Environment ready", error:"Environment not found", checking:"Checking…", warn:"Some packages missing" }[state] ?? state;
}

function renderEnvStatus(data) {
  const row = document.getElementById("env-status-row");
  const pkgList = document.getElementById("env-pkg-list");
  const pythonPath = document.getElementById("env-python-path");
  const installSection = document.getElementById("env-install-section");
  const condaHint = document.getElementById("env-conda-hint");
  const installCondaBtn = document.getElementById("env-install-conda-btn");
  const installPipBtn = document.getElementById("env-install-pip-btn");

  row?.classList.remove("hidden");
  installSection?.classList.remove("hidden");

  if (pythonPath) pythonPath.textContent = data.python || "—";

  const pkgs = data.packages || {};
  if (pkgList) {
    pkgList.innerHTML = [...PKG_REQUIRED, ...PKG_OPTIONAL].map(pkg => {
      const ver = pkgs[pkg];
      const required = PKG_REQUIRED.includes(pkg);
      const ok = !!ver;
      return `<span class="env-pkg ${ok ? "env-pkg--ok" : required ? "env-pkg--missing" : "env-pkg--optional"}">
        <span class="env-pkg-dot"></span>${pkg}${ok ? `<span class="env-pkg-ver">${ver}</span>` : ""}
      </span>`;
    }).join("");
  }

  const allOk = data.ok;
  setEnvLight(allOk ? "ok" : "error");

  if (!allOk) {
    const hasCondaHere = !!data.conda;
    installCondaBtn?.classList.toggle("hidden", !hasCondaHere);
    installPipBtn?.classList.remove("hidden");
    if (condaHint) condaHint.style.display = hasCondaHere ? "none" : "block";
  } else {
    installCondaBtn?.classList.add("hidden");
    installPipBtn?.classList.add("hidden");
    if (condaHint) condaHint.style.display = "none";
  }
}

function initEnvInstall(method) {
  const log = document.getElementById("env-install-log");
  if (log) { log.style.display = "block"; log.textContent = `Starting ${method} install…\n`; }

  postJSON("/api/env/install/start", { method }).then(({ job_id }) => {
    const evtSource = new EventSource(`/api/env/install/events/${job_id}`);
    evtSource.onmessage = (e) => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      if (log) log.textContent += data.message + "\n";
      if (log) log.scrollTop = log.scrollHeight;
      if (data.status === "done") {
        evtSource.close();
        setEnvLight("ok");
        loadEnvStatus();
      } else if (data.status === "error") {
        evtSource.close();
        setEnvLight("error");
      }
    };
  }).catch(e => {
    if (log) log.textContent += `Error: ${e.message}\n`;
    setEnvLight("error");
  });
}

// ── OME metadata badge ────────────────────────────────────────────────────────

async function fetchOmeBadge(strainName, el) {
  try {
    const data = await apiJSON(`/api/env/ome-info?strain=${encodeURIComponent(strainName)}`);
    if (data.is_ome) {
      const badge = document.createElement("span");
      badge.className = "ome-badge";
      badge.title = `OME-TIFF with embedded pixel size${data.pixel_um ? `: ${data.pixel_um} µm/px` : ""}`;
      badge.textContent = data.pixel_um ? `OME ✓ ${data.pixel_um}µm/px` : "OME ✓";
      el.appendChild(badge);
    }
  } catch {}
}

function initSetupTab() {
  // Environment check
  document.getElementById("env-check-btn")?.addEventListener("click", loadEnvStatus);
  document.getElementById("env-install-conda-btn")?.addEventListener("click", () => initEnvInstall("conda"));
  document.getElementById("env-install-pip-btn")?.addEventListener("click", () => initEnvInstall("pip"));
  document.getElementById("env-change-python-btn")?.addEventListener("click", () => {
    document.getElementById("env-change-form")?.classList.remove("hidden");
  });
  document.getElementById("env-python-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("env-change-form")?.classList.add("hidden");
  });
  document.getElementById("env-python-save-btn")?.addEventListener("click", async () => {
    const val = document.getElementById("env-python-input")?.value.trim();
    try {
      await postJSON("/api/env/set-python", { python_path: val });
      document.getElementById("env-change-form")?.classList.add("hidden");
      loadEnvStatus();
    } catch (e) { showError(e.message); }
  });

  // Toggle Add Strain form
  document.getElementById("show-add-strain-btn")?.addEventListener("click", () => {
    document.getElementById("add-strain-form").classList.remove("hidden");
  });
  document.getElementById("add-strain-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("add-strain-form").classList.add("hidden");
  });

  // Pick directory for new strain
  document.getElementById("pick-strain-dir-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("pick-strain-dir-btn");
    btn.disabled = true; btn.textContent = "Opening…";
    try {
      const result = await postJSON("/api/pick-directory", {});
      btn.disabled = false; btn.textContent = "Choose…";
      if (result.path) document.getElementById("new-strain-dir").value = result.path;
    } catch (e) {
      btn.disabled = false; btn.textContent = "Choose…";
      showError(e.message);
    }
  });

  // Add strain
  document.getElementById("add-strain-confirm-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("new-strain-name").value.trim();
    const source_dir = document.getElementById("new-strain-dir").value.trim();
    if (!name) { alert("Enter a strain name."); return; }
    try {
      await postJSON("/api/config/strain/add", { name, source_dir });
      state.config = await apiJSON("/api/config");
      document.getElementById("add-strain-form").classList.add("hidden");
      document.getElementById("new-strain-name").value = "";
      document.getElementById("new-strain-dir").value = "";
      await loadStrains();
      // Auto-import after adding
      if (source_dir) await importStrain(name);
    } catch (e) { showError(e.message); }
  });

  // Import all strains
  document.getElementById("import-all-strains-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("import-all-strains-btn");
    btn.disabled = true; btn.textContent = "Importing…";
    try {
      await apiFetch("/api/config/strain/import-all", { method: "POST" });
      await loadStrains();
    } catch (e) { showError(e.message); }
    finally { btn.disabled = false; btn.textContent = "Import All Strains"; }
  });

  // Toggle Add Analysis form
  document.getElementById("show-add-analysis-btn")?.addEventListener("click", () => {
    document.getElementById("add-analysis-form").classList.remove("hidden");
    loadModels();
    if (state.availableMeasurements.length === 0) loadAvailableMeasurements();
  });
  document.getElementById("add-analysis-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("add-analysis-form").classList.add("hidden");
  });

  // Auto-generate analysis ID from name
  document.getElementById("new-analysis-name")?.addEventListener("input", (e) => {
    const idInput = document.getElementById("new-analysis-id");
    if (idInput && !idInput.dataset.manuallyEdited) {
      idInput.value = slugify(e.target.value);
    }
  });
  document.getElementById("new-analysis-id")?.addEventListener("input", (e) => {
    e.target.dataset.manuallyEdited = "1";
  });

  // Save analysis
  document.getElementById("add-analysis-confirm-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("new-analysis-name").value.trim();
    const id = document.getElementById("new-analysis-id").value.trim();
    const model_path = document.getElementById("new-analysis-model").value;
    const diameter = document.getElementById("new-analysis-diameter").value;
    const min_area = parseInt(document.getElementById("new-analysis-min-area").value || "300");
    const max_area = parseInt(document.getElementById("new-analysis-max-area").value || "500000");
    const pixel_size_um = parseFloat(document.getElementById("new-analysis-pixel-size").value || "0.1075");
    const pixels_per_um_raw = document.getElementById("new-analysis-pixels-per-um").value;
    const measurements = getCheckedMeasurements();

    if (!name) { alert("Enter an analysis name."); return; }
    if (!id)   { alert("Enter an analysis ID."); return; }

    const body = {
      id, name, model_path, measurements, min_area, max_area, pixel_size_um,
      diameter: diameter ? parseFloat(diameter) : null,
      pixels_per_um: pixels_per_um_raw ? parseFloat(pixels_per_um_raw) : null,
    };
    try {
      await postJSON("/api/analyses/add", body);
      state.config = await apiJSON("/api/config");
      document.getElementById("add-analysis-form").classList.add("hidden");
      document.getElementById("new-analysis-name").value = "";
      document.getElementById("new-analysis-id").value = "";
      delete document.getElementById("new-analysis-id").dataset.manuallyEdited;
      await loadAnalyses();
      populateAnalysisSelects();
    } catch (e) { showError(e.message); }
  });
}

// ── Select Images tab — browser-based image selection (replaces napari) ───────

const selectState = {
  analysisId:   null,
  destination:  "curated",
  images:       [],    // [{abs_path, strain, filename, selected, viewed}]
  strainFilter: "all",
  viewMode:     "grid",   // "grid" | "single"
  singleIdx:    0,
  _observer:    null,
};

async function onSelectTabLoad() {
  populateAnalysisSelects();
  await refreshSetStatus();
}

// Updates the per-strain count rows in the Input/Curated/Training cards
async function refreshSetStatus() {
  const analysisId = getSelectedAnalysis("select") || "default";
  try {
    const data = await apiJSON(`/api/set-status?analysis_id=${encodedPath(analysisId)}`);
    renderSetStatus("input-set-status",    data.input    || {});
    renderSetStatus("curated-set-status",  data.curated  || {});
    renderSetStatus("training-set-status", data.training || {});
  } catch (_) { /* ignore */ }
}

function renderSetStatus(elId, counts) {
  const el = document.getElementById(elId);
  if (!el) return;
  const entries = Object.entries(counts);
  if (!entries.length) { el.innerHTML = '<span class="set-status-empty">Empty</span>'; return; }
  el.innerHTML = entries.map(([s, n]) =>
    `<div class="set-status-row"><span class="set-status-name">${s}</span><span class="set-status-count">${n}</span></div>`
  ).join("");
}

async function openSelectBrowser(destination) {
  const analysisId = getSelectedAnalysis("select");
  if (!analysisId) {
    const btn = document.getElementById(`browse-${destination}-btn`);
    if (btn) { const t = btn.textContent; btn.textContent = "Select an analysis first"; setTimeout(() => { btn.textContent = t; }, 1800); }
    return;
  }
  selectState.destination  = destination;
  selectState.analysisId   = analysisId;
  selectState.strainFilter = "all";
  selectState.singleIdx    = 0;
  document.getElementById("select-modal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setSelectViewMode("grid");
  await loadSelectImages();
}

async function closeSelectBrowser() {
  const closeBtn = document.getElementById("select-modal-close");
  if (closeBtn) { closeBtn.disabled = true; closeBtn.textContent = "Applying…"; }

  const selected = selectState.images.filter(i => i.selected).map(i => i.abs_path);
  try {
    const result = await postJSON("/api/select/apply", {
      analysis_id: selectState.analysisId,
      destination: selectState.destination,
      selected,
    });
    const infoEl = document.getElementById(`${selectState.destination}-sel-info`);
    if (infoEl && (result.added > 0 || result.removed > 0)) {
      const parts = [];
      if (result.added)   parts.push(`${result.added} added`);
      if (result.removed) parts.push(`${result.removed} removed`);
      infoEl.textContent = parts.join(", ") + ".";
      infoEl.classList.remove("hidden");
    } else if (infoEl) {
      infoEl.classList.add("hidden");
    }
  } catch (e) { console.error("apply failed:", e); }

  document.getElementById("select-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  if (closeBtn) { closeBtn.disabled = false; closeBtn.textContent = "✓ Done"; }
  if (selectState._observer) { selectState._observer.disconnect(); selectState._observer = null; }
  refreshSetStatus();
}

function setSelectViewMode(mode) {
  selectState.viewMode = mode;
  document.getElementById("select-modal-grid-view")?.classList.toggle("hidden", mode !== "grid");
  document.getElementById("select-modal-single-view")?.classList.toggle("hidden", mode !== "single");
  document.querySelectorAll(".select-view-btn").forEach(b => b.classList.toggle("btn-active", b.dataset.view === mode));
  if (mode === "single") renderSingleView();
}

async function loadSelectImages() {
  const { analysisId, destination } = selectState;
  const grid = document.getElementById("select-grid");
  if (grid) grid.innerHTML = '<div class="empty-state" style="padding:32px">Loading images…</div>';
  try {
    const data = await apiJSON(
      `/api/select/images?analysis_id=${encodedPath(analysisId)}&destination=${destination}`
    );
    // Pre-check images that are already in the destination set
    selectState.images = (data.images || []).map(img => ({ ...img, selected: img.in_set, viewed: img.in_set }));
    renderStrainTabs();
    renderSelectGrid();
    updateSelectStats();
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="empty-state" style="padding:32px">Error: ${e.message}</div>`;
  }
}

// Strain filter chips in the modal top bar
function renderStrainTabs() {
  const wrap = document.getElementById("select-modal-strains");
  if (!wrap) return;
  const strains = [...new Set(selectState.images.map(i => i.strain))].sort();
  const mkBtn = (label, strain, count) => {
    const active = selectState.strainFilter === strain ? " strain-tab-btn--active" : "";
    return `<button class="strain-tab-btn${active}" data-strain="${strain}">${label}<span class="tab-count"> ${count}</span></button>`;
  };
  wrap.innerHTML = mkBtn("All", "all", selectState.images.length)
    + strains.map(s => mkBtn(s, s, selectState.images.filter(i => i.strain === s).length)).join("");
  wrap.querySelectorAll(".strain-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectState.strainFilter = btn.dataset.strain;
      selectState.singleIdx = 0;
      renderStrainTabs();
      renderSelectGrid();
      if (selectState.viewMode === "single") renderSingleView();
    });
  });
}

function visibleSelectImages() {
  return selectState.strainFilter === "all"
    ? selectState.images
    : selectState.images.filter(i => i.strain === selectState.strainFilter);
}

function renderSelectGrid() {
  const grid = document.getElementById("select-grid");
  if (!grid) return;
  if (selectState._observer) { selectState._observer.disconnect(); selectState._observer = null; }

  const visible = visibleSelectImages();
  if (!visible.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:32px">No images found in data/input/ — import strain images in Setup first</div>';
    return;
  }

  grid.innerHTML = visible.map(img => {
    const idx      = selectState.images.indexOf(img);
    const selCls   = img.selected ? " cell-card--selected" : "";
    const viewCls  = img.viewed   ? " img-viewed"          : "";
    return `<div class="cell-card img-select-card${selCls}${viewCls}" data-idx="${idx}" tabindex="0">
      <div class="cell-card-img-wrap">
        <img class="cell-canvas" src="/api/curation/file?path=${encodedPath(img.abs_path)}&thumb=1" alt="">
        <div class="select-check-badge">✓</div>
      </div>
      <div class="cell-card-info">
        <span class="chip chip--dim" style="font-size:7px;padding:1px 4px;margin-bottom:1px">${img.strain}</span>
        <span title="${img.filename}">${img.filename}</span>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".img-select-card").forEach(card => {
    card.addEventListener("click", () => toggleSelectImage(+card.dataset.idx));
  });

  // Dim unviewed images; mark as viewed when they scroll into the scrollable container
  const scrollRoot = document.getElementById("select-modal-grid-view");
  selectState._observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = +entry.target.dataset.idx;
      const img = selectState.images[idx];
      if (img && !img.viewed) { img.viewed = true; entry.target.classList.add("img-viewed"); }
    });
  }, { root: scrollRoot, threshold: 0.4 });
  grid.querySelectorAll(".img-select-card").forEach(c => selectState._observer.observe(c));
}

function toggleSelectImage(idx) {
  const img = selectState.images[idx];
  if (!img) return;
  img.selected = !img.selected;
  img.viewed   = true;
  const card = document.querySelector(`#select-grid [data-idx="${idx}"]`);
  if (card) { card.classList.toggle("cell-card--selected", img.selected); card.classList.add("img-viewed"); }
  updateSelectStats();
}

function updateSelectStats() {
  const { images } = selectState;
  const sel    = images.filter(i => i.selected).length;
  const total  = images.length;
  const inSet  = images.filter(i => i.in_set).length;
  const statsEl = document.getElementById("select-stats");
  if (statsEl) statsEl.textContent = total > 0 ? `${sel} selected · ${inSet} currently in set · ${total} total` : "";
}

function renderSingleView() {
  const visible = visibleSelectImages();
  const idx = Math.max(0, Math.min(selectState.singleIdx, visible.length - 1));
  selectState.singleIdx = idx;

  const imgEl  = document.getElementById("select-single-img");
  const pos    = document.getElementById("select-single-pos");
  const strain = document.getElementById("select-single-strain");
  const name   = document.getElementById("select-single-name");
  const toggle = document.getElementById("select-single-toggle");

  if (!visible.length) {
    if (imgEl) imgEl.src = "";
    if (pos) pos.textContent = "No images";
    return;
  }

  const item      = visible[idx];
  const globalIdx = selectState.images.indexOf(item);

  if (imgEl) {
    imgEl.src = `/api/curation/file?path=${encodedPath(item.abs_path)}`;
    imgEl.alt = item.filename;
    imgEl.classList.toggle("single-img--selected", !!item.selected);
  }
  if (pos)    pos.textContent = `${idx + 1} / ${visible.length}`;
  if (strain) strain.textContent = item.strain;
  if (name)   name.textContent = item.filename;

  if (toggle) {
    toggle.textContent = item.selected ? "✓ Selected" : "Mark Selected";
    toggle.classList.toggle("select-single-selected", item.selected);
    toggle.onclick = () => { toggleSelectImage(globalIdx); renderSingleView(); };
  }

  // Mark as viewed
  if (!item.viewed) {
    item.viewed = true;
    const card = document.querySelector(`#select-grid [data-idx="${globalIdx}"]`);
    if (card) card.classList.add("img-viewed");
  }
}

function navSingle(delta) {
  const visible = visibleSelectImages();
  if (!visible.length) return;
  selectState.singleIdx = Math.max(0, Math.min(selectState.singleIdx + delta, visible.length - 1));
  renderSingleView();
}

function initSelectTab() {
  document.getElementById("analysis-select-select")?.addEventListener("change", refreshSetStatus);

  document.getElementById("browse-curated-btn")?.addEventListener("click",  () => openSelectBrowser("curated"));
  document.getElementById("browse-training-btn")?.addEventListener("click", () => openSelectBrowser("training"));

  document.getElementById("use-all-images-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("use-all-images-btn");
    const infoEl = document.getElementById("curated-sel-info");
    try { await confirmBtn(btn, "Use All — sure?"); } catch { return; }
    const analysisId = getSelectedAnalysis("select") || "default";
    btn.disabled = true; btn.textContent = "Copying…";
    try {
      const result = await postJSON("/api/use-all-images", { analysis_id: analysisId });
      if (infoEl) { infoEl.textContent = `${result.copied} images copied.`; infoEl.classList.remove("hidden"); }
      await refreshSetStatus();
    } catch (e) {
      if (infoEl) { infoEl.textContent = `Error: ${e.message}`; infoEl.classList.remove("hidden"); }
    } finally { btn.disabled = false; btn.textContent = "Use All"; }
  });

  document.getElementById("select-modal-close")?.addEventListener("click", closeSelectBrowser);
  document.getElementById("select-view-grid-btn")?.addEventListener("click",   () => setSelectViewMode("grid"));
  document.getElementById("select-view-single-btn")?.addEventListener("click", () => setSelectViewMode("single"));
  document.getElementById("select-single-prev")?.addEventListener("click",   () => navSingle(-1));
  document.getElementById("select-single-next")?.addEventListener("click",   () => navSingle(+1));
  document.getElementById("select-single-prev10")?.addEventListener("click", () => navSingle(-10));
  document.getElementById("select-single-next10")?.addEventListener("click", () => navSingle(+10));

  document.getElementById("select-all-btn")?.addEventListener("click", () => {
    visibleSelectImages().forEach(i => { i.selected = true; i.viewed = true; });
    document.querySelectorAll("#select-grid .img-select-card").forEach(c => c.classList.add("cell-card--selected", "img-viewed"));
    if (selectState.viewMode === "single") renderSingleView();
    updateSelectStats();
  });
  document.getElementById("select-deselect-all-btn")?.addEventListener("click", () => {
    visibleSelectImages().forEach(i => { i.selected = false; });
    document.querySelectorAll("#select-grid .img-select-card").forEach(c => c.classList.remove("cell-card--selected"));
    if (selectState.viewMode === "single") renderSingleView();
    updateSelectStats();
  });

  document.getElementById("select-modal")?.addEventListener("keydown", e => {
    if (document.getElementById("select-modal")?.classList.contains("hidden")) return;
    if (e.code === "Escape") { closeSelectBrowser(); return; }

    if (selectState.viewMode === "single") {
      const visible = visibleSelectImages();
      if (!visible.length) return;
      if      (e.code === "ArrowRight") { e.preventDefault(); navSingle(+1); }
      else if (e.code === "ArrowLeft")  { e.preventDefault(); navSingle(-1); }
      else if (e.code === "ArrowDown")  { e.preventDefault(); navSingle(+10); }
      else if (e.code === "ArrowUp")    { e.preventDefault(); navSingle(-10); }
      else if (e.code === "Space") {
        e.preventDefault();
        const item = visible[selectState.singleIdx];
        if (item) { toggleSelectImage(selectState.images.indexOf(item)); renderSingleView(); }
      } else if (e.code === "KeyJ") {
        e.preventDefault();
        const first = visible.findIndex(i => !i.viewed);
        selectState.singleIdx = first === -1 ? 0 : first;
        renderSingleView();
      }
      return;
    }

    // Grid keyboard nav
    const cards  = [...document.querySelectorAll("#select-grid .img-select-card")];
    const active = document.activeElement?.closest(".img-select-card");
    let visIdx   = active ? cards.indexOf(active) : -1;
    if      (e.code === "ArrowRight") { visIdx = Math.min(visIdx + 1, cards.length - 1); e.preventDefault(); }
    else if (e.code === "ArrowLeft")  { visIdx = Math.max(visIdx - 1, 0);                e.preventDefault(); }
    else if (e.code === "Space" && visIdx >= 0) { e.preventDefault(); toggleSelectImage(+cards[visIdx].dataset.idx); return; }
    else if (e.code === "KeyJ") {
      const first = visibleSelectImages().findIndex(i => !i.viewed);
      visIdx = first === -1 ? 0 : first;
      e.preventDefault();
    } else { return; }
    if (cards[visIdx]) { cards[visIdx].focus(); cards[visIdx].scrollIntoView({ block: "nearest" }); }
  });
}

// ── Train Model tab ───────────────────────────────────────────────────────────

async function onTrainTabLoad() {
  await refreshAvailableModels();
  await refreshTrainingStrainButtons();
  await refreshPrepareStrainChecklist();
}

async function refreshPrepareStrainChecklist() {
  const container = document.getElementById("prepare-strain-checklist");
  if (!container) return;
  try {
    const strains = await apiJSON("/api/training/strains");
    if (strains.length === 0) {
      container.innerHTML = '<span class="text-dim" style="font-size:11px">No training images found.</span>';
      return;
    }
    container.innerHTML = strains.map(s => `
      <label class="prepare-strain-check-label">
        <input type="checkbox" class="prepare-strain-check meas-check" value="${s.name}" checked />
        <span>${s.name}</span>
        <span class="text-dim" style="font-family:var(--font-mono);font-size:9.5px">${s.count}</span>
      </label>
    `).join("");
  } catch (e) {
    container.innerHTML = `<span class="text-dim" style="font-size:11px">Error: ${e.message}</span>`;
  }

  document.getElementById("prepare-select-all-btn")?.addEventListener("click", () => {
    document.querySelectorAll(".prepare-strain-check").forEach(cb => cb.checked = true);
  });
  document.getElementById("prepare-deselect-all-btn")?.addEventListener("click", () => {
    document.querySelectorAll(".prepare-strain-check").forEach(cb => cb.checked = false);
  });
}

function getSelectedPrepareStrains() {
  return Array.from(document.querySelectorAll(".prepare-strain-check:checked")).map(cb => cb.value);
}

async function refreshTrainingStrainButtons() {
  const container = document.getElementById("cellpose-strain-btns");
  if (!container) return;
  try {
    const strains = await apiJSON("/api/training/strains");
    if (strains.length === 0) {
      container.innerHTML = '<p class="empty-state">No training images found — copy images to a training set in Select Images first.</p>';
      return;
    }
    container.innerHTML = "";
    strains.forEach(s => {
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-sm cellpose-strain-btn";
      btn.innerHTML = `<span class="strain-btn-name">${s.name}</span><span class="strain-btn-count">${s.count} images</span>`;
      btn.title = `Opens: ${s.first_image}`;
      btn.addEventListener("click", () => launchCellposeForStrain(s.name, s.first_image, btn));
      container.appendChild(btn);
    });
  } catch (e) {
    container.innerHTML = `<p class="empty-state">Could not load training strains: ${e.message}</p>`;
  }
}

async function launchCellposeForStrain(strainName, imagePath, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="strain-btn-name">${strainName}</span><span class="strain-btn-count">Launching…</span>`;
  try {
    const result = await postJSON("/api/launch/cellpose-gui", { image_path: imagePath });
    btn.innerHTML = `<span class="strain-btn-name">${strainName}</span><span class="strain-btn-count">Running ✓</span>`;
    setTimeout(() => { btn.disabled = false; btn.innerHTML = orig; }, 4000);
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function refreshAvailableModels() {
  try {
    const data = await apiJSON("/api/models");
    const el = document.getElementById("available-models-list");
    if (el) {
      const models = data.models || [];
      el.innerHTML = models.length
        ? models.map(m => `<div class="py-1 border-b border-gray-800 text-emerald-400">${m.name}</div>`).join("")
        : '<span class="text-gray-500">No models yet.</span>';
    }
  } catch (e) { /* ignore */ }
}

function initTrainTab() {
  document.getElementById("launch-cellpose-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("launch-cellpose-btn");
    btn.disabled = true; btn.textContent = "Launching…";
    try {
      await postJSON("/api/launch/cellpose-gui", {});
    } catch (e) { showError(e.message); }
    finally { btn.disabled = false; btn.textContent = "Open Cellpose (no image)"; }
  });

  document.getElementById("prepare-training-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("prepare-training-btn");
    const logEl = document.getElementById("prepare-log");
    const selectedStrains = getSelectedPrepareStrains();
    btn.disabled = true; btn.textContent = "Preparing…";
    logEl.classList.remove("hidden");
    logEl.textContent = selectedStrains.length
      ? `Pooling strains: ${selectedStrains.join(", ")}\n`
      : "Pooling all strains…\n";
    try {
      const { job_id } = await postJSON("/api/training/prepare", { strains: selectedStrains });
      const evtSource = new EventSource(`/api/measure/events/${job_id}`);
      evtSource.onmessage = (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (d.message) { logEl.textContent += d.message + "\n"; logEl.scrollTop = logEl.scrollHeight; }
        if (d.status === "done" || d.status === "error") {
          evtSource.close(); btn.disabled = false; btn.textContent = "Prepare Training Data";
        }
      };
      evtSource.onerror = () => { evtSource.close(); btn.disabled = false; btn.textContent = "Prepare Training Data"; };
    } catch (e) {
      showError(e.message); btn.disabled = false; btn.textContent = "Prepare Training Data";
    }
  });

  document.getElementById("train-start-btn")?.addEventListener("click", async () => {
    const baseModel = document.getElementById("train-base-model")?.value || "cyto2";
    const epochs    = parseInt(document.getElementById("train-epochs")?.value || "200");
    const modelName = document.getElementById("train-model-name")?.value?.trim() || "CustomModel";

    const progSection = document.getElementById("train-progress-section");
    const progBar     = document.getElementById("train-progress-bar");
    const statusLabel = document.getElementById("train-status-label");
    const progLabel   = document.getElementById("train-progress-label");
    const logArea     = document.getElementById("train-log");
    const btn         = document.getElementById("train-start-btn");

    progSection.classList.remove("hidden");
    logArea.value = ""; progBar.style.width = "0%"; statusLabel.textContent = "Training…";
    btn.disabled = true;

    try {
      const { job_id } = await postJSON("/api/training/start", { base_model: baseModel, epochs, model_name: modelName });
      const evtSource = new EventSource(`/api/measure/events/${job_id}`);
      evtSource.onmessage = (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (d.message) { logArea.value += d.message + "\n"; logArea.scrollTop = logArea.scrollHeight; }
        if (d.total > 0) {
          const pct = Math.round((d.progress / d.total) * 100);
          progBar.style.width = pct + "%";
          progLabel.textContent = `Epoch ${d.progress} / ${d.total}`;
        }
        if (d.status === "done") {
          statusLabel.textContent = "Training complete!"; statusLabel.className = "text-emerald-400";
          progBar.style.width = "100%"; evtSource.close(); btn.disabled = false;
          refreshAvailableModels();
        } else if (d.status === "error") {
          statusLabel.textContent = "Error"; statusLabel.className = "text-red-400";
          evtSource.close(); btn.disabled = false;
        }
      };
      evtSource.onerror = () => { evtSource.close(); btn.disabled = false; };
    } catch (e) { showError(e.message); btn.disabled = false; }
  });

  document.getElementById("refresh-models-btn")?.addEventListener("click", refreshAvailableModels);
}

// ── Measure tab ───────────────────────────────────────────────────────────────

function onMeasureTabLoad() {
  populateAnalysisSelects();
  updateMeasureAnalysisSummary();
}

function updateMeasureAnalysisSummary() {
  const analysisId = getSelectedAnalysis("measure");
  const summaryDiv = document.getElementById("measure-analysis-summary");
  const detailDiv  = document.getElementById("measure-analysis-detail");
  const startBtn   = document.getElementById("measure-start-btn");
  const noAnalysis = document.getElementById("measure-no-analysis");

  if (!analysisId) {
    summaryDiv?.classList.add("hidden");
    if (startBtn) startBtn.disabled = true;
    if (noAnalysis) noAnalysis.classList.remove("hidden");
    return;
  }

  const analysis = (state.config.analyses || []).find(a => a.id === analysisId);
  if (!analysis) return;

  summaryDiv?.classList.remove("hidden");
  if (noAnalysis) noAnalysis.classList.add("hidden");
  if (startBtn) startBtn.disabled = false;

  if (detailDiv) {
    const modelName = analysis.model_path ? analysis.model_path.split("/").pop() : "—";
    detailDiv.innerHTML = `
      <div>Model: <span class="text-gray-200">${modelName}</span></div>
      <div>Min area: <span class="text-gray-200">${analysis.min_area} px²</span> · Max area: <span class="text-gray-200">${analysis.max_area} px²</span></div>
      <div>Diameter: <span class="text-gray-200">${analysis.diameter ?? "auto"} px</span> · Pixel size: <span class="text-gray-200">${analysis.pixel_size_um ?? "—"} µm/px</span></div>
      <div>Measurements: <span class="text-gray-200">${(analysis.measurements || []).join(", ")}</span></div>
    `;
  }
}

function initMeasureTab() {
  document.getElementById("analysis-select-measure")?.addEventListener("change", updateMeasureAnalysisSummary);
  document.getElementById("measure-start-btn")?.addEventListener("click", startMeasurement);
}

async function startMeasurement() {
  const analysisId = getSelectedAnalysis("measure");
  if (!analysisId) { alert("Select an analysis first."); return; }

  const progSection = document.getElementById("measure-progress-section");
  const progBar     = document.getElementById("measure-progress-bar");
  const progLabel   = document.getElementById("measure-progress-label");
  const statusLabel = document.getElementById("measure-status-label");
  const logArea     = document.getElementById("measure-log");
  const startBtn    = document.getElementById("measure-start-btn");

  progSection.classList.remove("hidden");
  logArea.value = ""; progBar.style.width = "0%";
  statusLabel.textContent = "Starting…"; startBtn.disabled = true;

  try {
    const { job_id } = await postJSON("/api/measure/start", { analysis_id: analysisId });
    const evtSource = new EventSource(`/api/measure/events/${job_id}`);

    evtSource.onmessage = (e) => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      if (data.message) { logArea.value += data.message + "\n"; logArea.scrollTop = logArea.scrollHeight; }
      if (data.total > 0) {
        const pct = Math.round((data.progress / data.total) * 100);
        progBar.style.width = pct + "%";
        progLabel.textContent = `${data.progress} / ${data.total}`;
      }
      if (data.status === "done") {
        statusLabel.textContent = "Done!"; statusLabel.className = "text-emerald-400";
        progBar.style.width = "100%"; evtSource.close(); startBtn.disabled = false;
      } else if (data.status === "error") {
        statusLabel.textContent = "Error"; statusLabel.className = "text-red-400";
        evtSource.close(); startBtn.disabled = false;
      } else {
        statusLabel.textContent = "Running…"; statusLabel.className = "text-gray-300";
      }
    };
    evtSource.onerror = () => {
      evtSource.close(); startBtn.disabled = false;
      statusLabel.textContent = "Connection error"; statusLabel.className = "text-red-400";
    };
  } catch (e) {
    showError(e.message); startBtn.disabled = false;
  }
}

// ── Curate tab ────────────────────────────────────────────────────────────────

// ── Curate tab ────────────────────────────────────────────────────────────────

const curateState = {
  analysisId: "",
  strain: "",
  cells: [],           // flat list from /api/curation/cells
  morphotypes: [],     // [{id, name, color}]
  selected: new Set(), // Set of "filename:cell_id" keys
  activeMorph: "accepted",
  morphFilter: null,   // null = show all; string = show only that morphotype
  viewMode: "grid",    // "grid" | "image"
  overlaysVisible: true,
  overlayType: "ellipse", // "ellipse" | "feret"
  imageIdx: 0,         // current image index in image view
  imageList: [],       // [{idx, strain, filename, filepath, cells:[]}]
};

async function onCurateTabLoad() {
  populateAnalysisSelects();
  const sel = document.getElementById("analysis-select-curate");
  if (sel) sel.addEventListener("change", () => loadCurateAnalysis(sel.value));
  document.getElementById("curate-strain-filter")?.addEventListener("change", (e) => {
    curateState.strain = e.target.value;
    if (curateState.viewMode === "grid") renderCurateGrid();
    else renderImageView();
    renderStatsTable();
  });
  document.getElementById("curate-select-all-btn")?.addEventListener("click", () => {
    visibleCells().forEach(c => curateState.selected.add(cellKey(c)));
    refreshSelection();
  });
  document.getElementById("curate-deselect-btn")?.addEventListener("click", () => {
    curateState.selected.clear();
    refreshSelection();
  });
  document.getElementById("curate-export-split-btn")?.addEventListener("click", exportSplit);
  document.getElementById("curate-export-csv-btn")?.addEventListener("click", exportCSV);
  document.getElementById("add-morph-btn")?.addEventListener("click", () => {
    document.getElementById("add-morph-form").classList.remove("hidden");
  });
  document.getElementById("add-morph-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("add-morph-form").classList.add("hidden");
  });
  document.getElementById("add-morph-confirm-btn")?.addEventListener("click", addMorphotype);

  // View toggle
  document.getElementById("view-grid-btn")?.addEventListener("click", () => switchView("grid"));
  document.getElementById("view-image-btn")?.addEventListener("click", () => switchView("image"));

  // Regen crops (rebuilds matplotlib-era PNGs → raw PIL crops for correct overlay alignment)
  document.getElementById("regen-crops-btn")?.addEventListener("click", regenCrops);

  // Overlay toggle + ellipse/feret type
  document.getElementById("toggle-overlay-btn")?.addEventListener("click", toggleOverlay);
  document.getElementById("overlay-ellipse-btn")?.addEventListener("click", () => setOverlayType("ellipse"));
  document.getElementById("overlay-feret-btn")?.addEventListener("click",   () => setOverlayType("feret"));

  // Image view navigation
  document.getElementById("img-prev-btn")?.addEventListener("click", () => navigateImageView(-1));
  document.getElementById("img-next-btn")?.addEventListener("click", () => navigateImageView(1));

  // Arrow key navigation when in image view (guard: not typing in an input)
  document.addEventListener("keydown", e => {
    if (curateState.viewMode !== "image") return;
    if (document.getElementById("image-view-wrap")?.classList.contains("hidden")) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    if      (e.code === "ArrowRight") { e.preventDefault(); navigateImageView(+1); }
    else if (e.code === "ArrowLeft")  { e.preventDefault(); navigateImageView(-1); }
  });

  initResizeHandles();
  initDragSelect();

  const aid = sel?.value;
  if (aid) await loadCurateAnalysis(aid);
}

function switchView(mode) {
  curateState.viewMode = mode;
  const gridWrap = document.getElementById("cell-grid-wrap");
  const imgWrap  = document.getElementById("image-view-wrap");
  const sidebar  = document.getElementById("image-cell-sidebar");
  const gridBtn  = document.getElementById("view-grid-btn");
  const imgBtn   = document.getElementById("view-image-btn");

  if (mode === "grid") {
    gridWrap?.classList.remove("hidden");
    imgWrap?.classList.add("hidden");
    sidebar?.classList.add("hidden");
    gridBtn?.classList.add("view-toggle-btn--active");
    imgBtn?.classList.remove("view-toggle-btn--active");
  } else {
    gridWrap?.classList.add("hidden");
    imgWrap?.classList.remove("hidden");
    sidebar?.classList.remove("hidden");
    imgBtn?.classList.add("view-toggle-btn--active");
    gridBtn?.classList.remove("view-toggle-btn--active");
    renderImageView();
  }
}

function toggleOverlay() {
  curateState.overlaysVisible = !curateState.overlaysVisible;
  const btn = document.getElementById("toggle-overlay-btn");
  if (btn) btn.textContent = curateState.overlaysVisible ? "Overlays ✓" : "Overlays ✗";
  redrawAllOverlays();
}

function setOverlayType(type) {
  curateState.overlayType = type;
  document.getElementById("overlay-ellipse-btn")?.classList.toggle("view-toggle-btn--active", type === "ellipse");
  document.getElementById("overlay-feret-btn")?.classList.toggle("view-toggle-btn--active",   type === "feret");
  redrawAllOverlays();
}

function redrawAllOverlays() {
  document.querySelectorAll(".cell-canvas[data-key]").forEach(cvs => {
    if (cvs._imgObj?.complete) redrawCellCanvas(cvs);
  });
  if (curateState.viewMode === "image") redrawImageViewCanvas();
}

async function regenCrops() {
  const btn = document.getElementById("regen-crops-btn");
  if (!curateState.analysisId) return;
  const origText = btn.textContent;
  btn.textContent = "Rebuilding…";
  btn.disabled = true;
  try {
    const res = await apiJSON(`/api/analyses/${encodedPath(curateState.analysisId)}/regen-crops`, {method:"POST"});
    _cropCacheBust = `&_v=${Date.now()}`;
    btn.textContent = `✓ ${res.regenerated} crops`;
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
    // Reload the grid so canvases fetch fresh PNGs from disk
    renderCurateGrid();
  } catch (e) {
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2500);
    showToast("Regen crops failed: " + e.message, "error");
  }
}

function cellKey(c) { return `${c.filename}:${c.cell_id}`; }

function visibleCells() {
  return curateState.cells.filter(c => {
    if (curateState.strain && c.strain !== curateState.strain) return false;
    if (curateState.morphFilter && c.morphotype !== curateState.morphFilter) return false;
    return true;
  });
}

async function loadCurateAnalysis(analysisId) {
  if (!analysisId) return;
  curateState.analysisId = analysisId;
  curateState.selected.clear();
  curateState.morphFilter = null;

  const [morphotypes, cells, strains] = await Promise.all([
    apiJSON(`/api/curation/morphotypes?analysis_id=${encodedPath(analysisId)}`).catch(() => []),
    apiJSON(`/api/curation/cells?analysis_id=${encodedPath(analysisId)}`).catch(() => []),
    apiJSON(`/api/curation/strains?analysis_id=${encodedPath(analysisId)}`).catch(() => []),
  ]);

  curateState.morphotypes = morphotypes.length ? morphotypes : [
    {id:"accepted",name:"Accepted",color:"#4a6830"},
    {id:"rejected",name:"Rejected",color:"#8b2020"},
  ];
  curateState.cells = cells;

  // Build image list for per-image view (from cells, preserving image order)
  const imgMap = new Map();
  cells.forEach(c => {
    if (!imgMap.has(c.filename)) imgMap.set(c.filename, {filename: c.filename, strain: c.strain, cells: []});
    imgMap.get(c.filename).cells.push(c);
  });
  curateState.imageList = [...imgMap.values()];
  curateState.imageIdx = 0;

  const sf = document.getElementById("curate-strain-filter");
  if (sf) {
    sf.innerHTML = '<option value="">All strains</option>';
    strains.forEach(s => { const o = document.createElement("option"); o.value=s; o.textContent=s; sf.appendChild(o); });
  }

  renderMorphPanel();
  renderMorphBtns();
  if (curateState.viewMode === "grid") renderCurateGrid();
  else renderImageView();
  renderStatsTable();
  renderMorphStats();
}

function renderMorphPanel() {
  const list = document.getElementById("morph-list");
  if (!list) return;
  list.innerHTML = "";
  const filtered = curateState.morphFilter;
  curateState.morphotypes.forEach(m => {
    const isFiltered = filtered === m.id;
    const el = document.createElement("div");
    el.className = "morph-item" + (isFiltered ? " morph-item--filtered" : "");
    el.title = isFiltered ? "Click to clear filter" : `Click to filter to "${m.name}" only`;
    el.innerHTML = `
      <span class="morph-swatch" style="background:${m.color}"></span>
      <span class="morph-name">${m.name}</span>
      <span class="morph-count" id="morph-count-${m.id}">0</span>
      ${isFiltered ? `<span class="morph-filter-badge">filter</span>` : ""}
      ${m.id !== "accepted" && m.id !== "rejected" ? `<button class="morph-del-btn" data-id="${m.id}">✕</button>` : ""}
    `;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("morph-del-btn")) { deleteMorphotype(m.id); return; }
      curateState.morphFilter = isFiltered ? null : m.id;
      curateState.imageIdx = 0;
      renderMorphPanel();
      if (curateState.viewMode === "grid") renderCurateGrid();
      else renderImageView();
      renderStatsTable();
    });
    list.appendChild(el);
  });
  updateMorphCounts();
}

function renderMorphBtns() {
  const row = document.getElementById("curate-morph-btns");
  if (!row) return;
  row.innerHTML = "";
  curateState.morphotypes.forEach(m => {
    const btn = document.createElement("button");
    btn.className = "morph-assign-btn" + (m.id === curateState.activeMorph ? " morph-assign-btn--active" : "");
    btn.style.setProperty("--morph-color", m.color);
    btn.textContent = m.name;
    btn.title = `Assign selected to "${m.name}"`;
    btn.addEventListener("click", () => assignSelected(m.id));
    row.appendChild(btn);
  });
}

function updateMorphCounts() {
  const counts = {};
  curateState.cells.forEach(c => { counts[c.morphotype] = (counts[c.morphotype] || 0) + 1; });
  curateState.morphotypes.forEach(m => {
    const el = document.getElementById(`morph-count-${m.id}`);
    if (el) el.textContent = counts[m.id] || 0;
  });
}

function renderMorphStats() {
  const el = document.getElementById("morph-stats");
  if (!el) return;
  const total = curateState.cells.length;
  el.innerHTML = `<div class="morph-stat-total">${total} cells total</div>`;
}

async function addMorphotype() {
  const name = document.getElementById("new-morph-name")?.value.trim();
  const color = document.getElementById("new-morph-color")?.value || "#2080c0";
  if (!name) return;
  const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (curateState.morphotypes.find(m => m.id === id)) { alert("Morphotype already exists"); return; }
  curateState.morphotypes.push({id, name, color});
  await saveMorphotypes();
  document.getElementById("add-morph-form").classList.add("hidden");
  document.getElementById("new-morph-name").value = "";
  renderMorphPanel();
  renderMorphBtns();
}

async function deleteMorphotype(id) {
  const btn = document.querySelector(`.morph-del-btn[data-id="${id}"]`);
  if (btn) { try { await confirmBtn(btn, "Delete?", 2500); } catch { return; } }
  curateState.morphotypes = curateState.morphotypes.filter(m => m.id !== id);
  await saveMorphotypes();
  renderMorphPanel();
  renderMorphBtns();
  renderCurateGrid();
}

async function saveMorphotypes() {
  await postJSON("/api/curation/morphotypes", {
    analysis_id: curateState.analysisId,
    morphotypes: curateState.morphotypes,
  });
}

async function assignSelected(morphId) {
  if (!curateState.selected.size) return;
  const assignments = [];
  curateState.cells.forEach(c => {
    if (curateState.selected.has(cellKey(c))) {
      c.morphotype = morphId;
      assignments.push({filename: c.filename, cell_id: c.cell_id, morphotype: morphId});
    }
  });
  // Update UI immediately before the network call so assignment feels instant
  curateState.selected.clear();
  refreshSelection();
  updateMorphCounts();
  renderMorphStats();
  renderStatsTable();
  document.querySelectorAll(".cell-card").forEach(card => {
    const key = card.dataset.key;
    const cell = curateState.cells.find(c => cellKey(c) === key);
    if (cell) applyCardMorph(card, cell.morphotype);
  });
  if (curateState.viewMode === "image" && _imageViewImgData) {
    renderImageCellSidebar(_imageViewImgData.cells);
  }
  // Persist in background
  await postJSON("/api/curation/assign", {
    analysis_id: curateState.analysisId,
    assignments,
  });
}

function applyCardMorph(card, morphId) {
  const m = curateState.morphotypes.find(m => m.id === morphId);
  card.style.setProperty("--card-morph-color", m ? m.color : "#444");
  card.dataset.morph = morphId;
  // Update badge text and color
  const badge = card.querySelector(".cell-morph-badge");
  if (badge) {
    badge.style.background = m ? m.color : "#444";
    badge.textContent = m ? m.name : morphId;
  }
}

// Draws crop image + measurement lines onto a single canvas — no alignment drift
function redrawCellCanvas(cvs) {
  if (!cvs._imgObj || !cvs._cellData) return;
  const cell = cvs._cellData;
  const img  = cvs._imgObj;
  cvs.width  = img.naturalWidth;
  cvs.height = img.naturalHeight;
  const ctx  = cvs.getContext("2d");
  ctx.drawImage(img, 0, 0);
  if (!curateState.overlaysVisible) return;

  // Crop origin matches save_cell_crop: max(0, bbox_edge - 40px padding)
  const pad = 40;
  const r0  = Math.max(0, cell.bbox[0] - pad);
  const c0  = Math.max(0, cell.bbox[1] - pad);
  const cx  = cell.centroid_x_px - c0;
  const cy  = cell.centroid_y_px - r0;
  const px  = cell.pixel_size_um || 0.1075;
  const lw  = Math.max(1, img.naturalWidth / 80);
  const dot = Math.max(2, img.naturalWidth / 60);

  // skimage angles: angle from row axis → dx = sin(θ), dy = cos(θ) in canvas (x=col, y=row)
  function drawLine(halfLen, angle, color) {
    const ux = Math.sin(angle), uy = Math.cos(angle);
    ctx.beginPath();
    ctx.moveTo(cx - ux*halfLen, cy - uy*halfLen);
    ctx.lineTo(cx + ux*halfLen, cy + uy*halfLen);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  }

  if (curateState.overlayType === "feret") {
    if (cell.feret_max_angle_rad != null && cell.feret_max_um)
      drawLine((cell.feret_max_um / 2) / px, cell.feret_max_angle_rad, "rgba(255,140,0,0.9)");
    if (cell.feret_min_angle_rad != null && cell.feret_min_um)
      drawLine((cell.feret_min_um / 2) / px, cell.feret_min_angle_rad, "rgba(0,210,210,0.9)");
  } else {
    const ang = cell.orientation_rad || 0;
    drawLine((cell.length_um  / 2) / px, ang,              "rgba(255,220,50,0.9)");
    drawLine((cell.breadth_um / 2) / px, ang + Math.PI/2,  "rgba(80,200,255,0.9)");
  }

  ctx.beginPath(); ctx.arc(cx, cy, dot, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();
}

function renderCurateGrid() {
  const grid = document.getElementById("cell-grid");
  if (!grid) return;

  const cells = visibleCells();
  const existing = document.getElementById("drag-select-rect");
  grid.innerHTML = "";
  if (existing) grid.appendChild(existing);

  if (!cells.length) {
    const empty = document.createElement("p");
    empty.id = "cell-grid-empty";
    empty.className = "empty-state";
    empty.textContent = curateState.cells.length ? "No cells for selected strain." : "No cells found.";
    grid.appendChild(empty);
    return;
  }

  cells.forEach(cell => {
    const card = document.createElement("div");
    card.className = "cell-card";
    card.dataset.key = cellKey(cell);
    card.dataset.morph = cell.morphotype;
    card.dataset.filename = cell.filename;
    card.dataset.cellId = cell.cell_id;

    const m = curateState.morphotypes.find(m => m.id === cell.morphotype);
    card.style.setProperty("--card-morph-color", m ? m.color : "#555");
    if (curateState.selected.has(cellKey(cell))) card.classList.add("cell-card--selected");

    const imgWrap = document.createElement("div");
    imgWrap.className = "cell-card-img-wrap";

    // Single canvas — draws image + overlays together, zero alignment drift
    const cvs = document.createElement("canvas");
    cvs.className = "cell-canvas";
    cvs.dataset.key = cellKey(cell);
    cvs._cellData = cell;

    const imgObj = new Image();
    cvs._imgObj = imgObj;
    imgObj.addEventListener("load", () => redrawCellCanvas(cvs));
    imgObj.addEventListener("error", () => {
      cvs.width = 120; cvs.height = 120;
      const ctx = cvs.getContext("2d");
      ctx.fillStyle = "#222"; ctx.fillRect(0, 0, 120, 120);
      ctx.fillStyle = "#888"; ctx.font = "11px sans-serif";
      ctx.textAlign = "center"; ctx.fillText("no image", 60, 65);
    });
    imgObj.src = `/api/curation/file?path=${encodeURIComponent(cell.crop_path)}${_cropCacheBust}`;

    const badge = document.createElement("div");
    badge.className = "cell-morph-badge";
    badge.style.background = m ? m.color : "#555";
    badge.textContent = m ? m.name : cell.morphotype;

    const info = document.createElement("div");
    info.className = "cell-card-info";
    info.innerHTML = `
      <span title="Length">L: ${cell.length_um?.toFixed(1) ?? "—"}µm</span>
      <span title="Breadth">B: ${cell.breadth_um?.toFixed(1) ?? "—"}µm</span>
      <span title="Aspect ratio">AR: ${cell.aspect_ratio?.toFixed(2) ?? "—"}</span>
    `;

    imgWrap.appendChild(cvs);
    imgWrap.appendChild(badge);
    card.appendChild(imgWrap);
    card.appendChild(info);

    card.addEventListener("click", () => { toggleCardSelect(card, cell); renderStatsTable(); });
    grid.appendChild(card);
  });
}

// (cell overlay drawing is handled by redrawCellCanvas for grid view
//  and redrawImageViewCanvas for image view)

function toggleCardSelect(card, cell) {
  const key = cellKey(cell);
  if (curateState.selected.has(key)) {
    curateState.selected.delete(key);
    card.classList.remove("cell-card--selected");
  } else {
    curateState.selected.add(key);
    card.classList.add("cell-card--selected");
  }
  updateSelectionCount();
}

function refreshSelection() {
  document.querySelectorAll(".cell-card").forEach(card => {
    const sel = curateState.selected.has(card.dataset.key);
    card.classList.toggle("cell-card--selected", sel);
  });
  updateSelectionCount();
}

function updateSelectionCount() {
  const el = document.getElementById("curate-selection-count");
  if (el) el.textContent = curateState.selected.size ? `${curateState.selected.size} selected` : "";
}

function renderStatsTable() {
  const tbody = document.getElementById("curate-stats-tbody");
  const countEl = document.getElementById("stats-count");
  if (!tbody) return;
  const cells = visibleCells();
  tbody.innerHTML = "";
  cells.forEach(c => {
    const tr = document.createElement("tr");
    if (curateState.selected.has(cellKey(c))) tr.classList.add("row--selected");
    const m = curateState.morphotypes.find(m => m.id === c.morphotype);
    tr.innerHTML = `
      <td>${c.strain}</td>
      <td class="mono" title="${c.filename}">${c.filename.replace(/\.[^.]+$/, "").slice(-20)}</td>
      <td class="r">${c.cell_id}</td>
      <td class="r">${c.length_um?.toFixed(2) ?? "—"}</td>
      <td class="r">${c.breadth_um?.toFixed(2) ?? "—"}</td>
      <td class="r">${c.aspect_ratio?.toFixed(3) ?? "—"}</td>
      <td class="r">${c.feret_max_um?.toFixed(2) ?? "—"}</td>
      <td class="r">${c.area_um2?.toFixed(1) ?? "—"}</td>
      <td class="r">${c.solidity?.toFixed(3) ?? "—"}</td>
      <td><span class="morph-chip" style="background:${m?.color ?? "#555"}">${m?.name ?? c.morphotype}</span></td>
    `;
    tbody.appendChild(tr);
  });
  if (countEl) countEl.textContent = `${cells.length} cells`;
}

// ── Drag-select ───────────────────────────────────────────────────────────────

function initDragSelect() {
  const grid = document.getElementById("cell-grid");
  if (!grid) return;
  let dragging = false, startX = 0, startY = 0;
  const getRectEl = () => document.getElementById("drag-select-rect");

  grid.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".cell-card")) return;
    dragging = true;
    const gr = grid.getBoundingClientRect();
    startX = e.clientX - gr.left + grid.scrollLeft;
    startY = e.clientY - gr.top + grid.scrollTop;
    const rect = getRectEl();
    if (rect) {
      rect.style.left = startX + "px"; rect.style.top = startY + "px";
      rect.style.width = "0"; rect.style.height = "0";
      rect.classList.remove("hidden");
    }
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const gr = grid.getBoundingClientRect();
    const curX = e.clientX - gr.left + grid.scrollLeft;
    const curY = e.clientY - gr.top + grid.scrollTop;
    const x = Math.min(startX, curX), y = Math.min(startY, curY);
    const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    const rect = getRectEl();
    if (rect) {
      rect.style.left = x + "px"; rect.style.top = y + "px";
      rect.style.width = w + "px"; rect.style.height = h + "px";
    }
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    const rect = getRectEl();
    if (rect) {
      rect.classList.add("hidden");
      if (rect.offsetWidth > 4 && rect.offsetHeight > 4) {
        selectCellsInRect(rect.getBoundingClientRect());
        renderStatsTable();
      }
    }
  });
}

function selectCellsInRect(selRect) {
  document.querySelectorAll(".cell-card").forEach(card => {
    const cr = card.getBoundingClientRect();
    const overlaps = !(cr.right < selRect.left || cr.left > selRect.right ||
                       cr.bottom < selRect.top  || cr.top > selRect.bottom);
    if (overlaps) {
      curateState.selected.add(card.dataset.key);
      card.classList.add("cell-card--selected");
    }
  });
  updateSelectionCount();
}

// ── Resize handles ────────────────────────────────────────────────────────────

function initResizeHandles() {
  const vHandle = document.getElementById("morph-resize-handle");
  const morphPanel = document.getElementById("morph-panel");
  if (vHandle && morphPanel) {
    let dragging = false, startX = 0, startW = 0;
    vHandle.addEventListener("mousedown", (e) => {
      dragging = true; startX = e.clientX; startW = morphPanel.offsetWidth;
      document.body.style.cursor = "col-resize"; e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const w = Math.max(120, Math.min(400, startW + e.clientX - startX));
      morphPanel.style.width = w + "px";
    });
    window.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.style.cursor = ""; } });
  }

  const hHandle = document.getElementById("stats-resize-handle");
  const statsPanel = document.getElementById("curate-stats-panel");
  if (hHandle && statsPanel) {
    let dragging = false, startY = 0, startH = 0;
    hHandle.addEventListener("mousedown", (e) => {
      dragging = true; startY = e.clientY; startH = statsPanel.offsetHeight;
      document.body.style.cursor = "row-resize"; e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const h = Math.max(80, Math.min(600, startH - (e.clientY - startY)));
      statsPanel.style.height = h + "px";
    });
    window.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.style.cursor = ""; } });
  }
}

async function exportSplit() {
  const aid = curateState.analysisId;
  if (!aid) return;
  try {
    const result = await postJSON("/api/curation/export-split", {analysis_id: aid});
    const lines = Object.entries(result.exported).map(([k,v]) => `  ${k}: ${v} cells`).join("\n");
    alert(`Export complete!\n\n${lines}\n\nSaved to: ${result.out_dir}`);
  } catch(e) { showError(e.message); }
}

async function exportCSV() {
  const aid = curateState.analysisId;
  if (!aid) return;
  window.location.href = `/api/curation/export?analysis_id=${encodedPath(aid)}`;
}

function initCurateTab() {
  // intentionally empty — listeners set up in onCurateTabLoad
}

// ── Image view ────────────────────────────────────────────────────────────────

function visibleImageList() {
  return curateState.imageList.filter(im => {
    if (curateState.strain && im.strain !== curateState.strain) return false;
    if (curateState.morphFilter) {
      // Only include images that have at least one cell matching the morph filter
      if (!im.cells.some(c => c.morphotype === curateState.morphFilter)) return false;
    }
    return true;
  });
}

function navigateImageView(delta) {
  const list = visibleImageList();
  if (!list.length) return;
  curateState.imageIdx = (curateState.imageIdx + delta + list.length) % list.length;
  renderImageView();
}

function renderImageView() {
  const list = visibleImageList();
  const navLabel = document.getElementById("img-nav-label");
  const filenameBadge = document.getElementById("img-filename-badge");
  if (!list.length) {
    if (navLabel) navLabel.textContent = "No images";
    return;
  }
  const idx = Math.min(curateState.imageIdx, list.length - 1);
  curateState.imageIdx = idx;
  const imgData = list[idx];
  if (navLabel) navLabel.textContent = `${idx + 1} / ${list.length}`;
  if (filenameBadge) filenameBadge.textContent = imgData.filename;

  // Load source image — filepath is in DATA_DIR (curated source)
  // We need to look it up from API cells data. Use the first cell's filepath from measurements.
  // The imageList was built from cells; cells have strain/filename but not filepath directly.
  // Fetch the full image data to get filepath.
  loadImageViewImage(imgData);
  renderImageCellSidebar(imgData.cells);
}

// Cached images for the full-image view
let _cropCacheBust = "";  // updated after regen-crops to force browser to reload PNG files
let _imageViewImg     = null;
let _imageViewMaskImg = null;
let _imageViewImgData = null;
let _imageViewFullIdx = -1;

async function loadImageViewImage(imgData) {
  const canvas = document.getElementById("image-view-canvas");
  if (!canvas) return;

  let filepath = "";
  let fullIdx  = -1;
  try {
    const apiImages = await apiJSON(
      `/api/curation/images?analysis_id=${encodedPath(curateState.analysisId)}`
    );
    fullIdx = apiImages.findIndex(im => im.filename === imgData.filename);
    if (fullIdx >= 0) filepath = apiImages[fullIdx].filepath;
  } catch {}
  if (!filepath) return;

  _imageViewImgData = imgData;
  _imageViewFullIdx = fullIdx;
  _imageViewMaskImg = null;

  // Load source image (TIFF served as PNG by backend)
  const img = new Image();
  img.onload = () => {
    _imageViewImg = img;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.maxWidth  = "100%";
    canvas.style.maxHeight = "100%";
    canvas.style.width     = "";
    canvas.style.height    = "";
    redrawImageViewCanvas();
  };
  img.src = `/api/curation/file?path=${encodeURIComponent(filepath)}`;

  // Load mask overlay (coloured RGBA PNG, same pixel dimensions as source)
  if (fullIdx >= 0) {
    const maskImg = new Image();
    maskImg.onload  = () => { _imageViewMaskImg = maskImg; redrawImageViewCanvas(); };
    maskImg.onerror = () => { _imageViewMaskImg = null; };
    maskImg.src = `/api/curation/overlay/${fullIdx}?analysis_id=${encodedPath(curateState.analysisId)}`;
  }
}

function reloadMaskOverlay() {
  if (_imageViewFullIdx < 0) return;
  _imageViewMaskImg = null;
  const maskImg = new Image();
  maskImg.onload  = () => { _imageViewMaskImg = maskImg; redrawImageViewCanvas(); };
  maskImg.onerror = () => { _imageViewMaskImg = null; };
  maskImg.src = `/api/curation/overlay/${_imageViewFullIdx}?analysis_id=${encodedPath(curateState.analysisId)}&_t=${Date.now()}`;
}

// Draws source image, mask overlay, then measurement lines — all on the same canvas
function redrawImageViewCanvas() {
  const canvas = document.getElementById("image-view-canvas");
  if (!canvas || !_imageViewImg || !_imageViewImgData) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_imageViewImg, 0, 0);

  if (!curateState.overlaysVisible) return;

  // Mask fill layer (coloured RGBA PNG from /api/curation/overlay)
  if (_imageViewMaskImg) ctx.drawImage(_imageViewMaskImg, 0, 0);

  const lw = Math.max(1.5, canvas.width / 800);
  const fs = Math.max(14,  canvas.width / 80);

  _imageViewImgData.cells.forEach(cell => {
    if (!cell.bbox || cell.centroid_x_px == null) return;
    const [r1, c1, r2, c2] = cell.bbox;
    const cx = cell.centroid_x_px;
    const cy = cell.centroid_y_px;
    const px = cell.pixel_size_um || 0.1075;
    const sel = curateState.selected.has(cellKey(cell));

    // Dashed bounding box — subtle selection indicator
    ctx.save();
    ctx.setLineDash([lw * 4, lw * 3]);
    ctx.strokeStyle = sel ? "rgba(255,216,0,0.9)" : "rgba(180,180,180,0.3)";
    ctx.lineWidth   = sel ? lw * 1.5 : lw * 0.7;
    ctx.strokeRect(c1, r1, c2 - c1, r2 - r1);
    ctx.restore();

    // Measurement lines — skimage angles: dx=sin(θ), dy=cos(θ)
    function drawLine(halfLen, angle, color) {
      const ux = Math.sin(angle), uy = Math.cos(angle);
      ctx.beginPath();
      ctx.moveTo(cx - ux*halfLen, cy - uy*halfLen);
      ctx.lineTo(cx + ux*halfLen, cy + uy*halfLen);
      ctx.strokeStyle = color; ctx.lineWidth = lw * 1.5; ctx.stroke();
    }

    if (curateState.overlayType === "feret") {
      if (cell.feret_max_angle_rad != null && cell.feret_max_um)
        drawLine((cell.feret_max_um / 2) / px, cell.feret_max_angle_rad, "rgba(255,140,0,0.9)");
      if (cell.feret_min_angle_rad != null && cell.feret_min_um)
        drawLine((cell.feret_min_um / 2) / px, cell.feret_min_angle_rad, "rgba(0,210,210,0.9)");
    } else {
      const ang = cell.orientation_rad || 0;
      drawLine((cell.length_um  / 2) / px, ang,             "rgba(255,220,50,0.9)");
      drawLine((cell.breadth_um / 2) / px, ang + Math.PI/2, "rgba(80,200,255,0.9)");
    }

    // Centroid dot
    ctx.beginPath(); ctx.arc(cx, cy, lw * 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();

    // Cell ID label
    ctx.font = `${fs}px monospace`;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(cell.cell_id, c1+2, r1+fs+1);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(cell.cell_id, c1+1, r1+fs);
  });
}

function renderImageCellSidebar(cells) {
  const list = document.getElementById("img-cell-list");
  const count = document.getElementById("img-cell-count");
  if (!list) return;
  if (count) count.textContent = `${cells.length} cells`;
  list.innerHTML = "";
  cells.forEach(cell => {
    const m = curateState.morphotypes.find(m => m.id === cell.morphotype);
    const el = document.createElement("div");
    el.className = "img-cell-row" + (curateState.selected.has(cellKey(cell)) ? " img-cell-row--selected" : "");
    el.innerHTML = `
      <span class="img-cell-id">#${cell.cell_id}</span>
      <span class="img-cell-metrics">${cell.length_um?.toFixed(1)}×${cell.breadth_um?.toFixed(1)}µm</span>
      <span class="morph-chip" style="background:${m?.color ?? '#555'}">${m?.name ?? cell.morphotype}</span>
    `;
    el.addEventListener("click", () => {
      toggleCardSelect(el, cell);
      renderImageCellSidebar(cells);
      redrawImageViewCanvas();
    });
    list.appendChild(el);
  });
}

// ── Results tab ───────────────────────────────────────────────────────────────

// Chart.js instances — kept so they can be destroyed before re-render
const _charts = {};

// Per-strain color palette (earthy, readable on dark backgrounds)
const STRAIN_COLORS = [
  "#c09030","#4a8850","#4878b0","#a04880","#c06020","#30a0a0",
  "#8888c0","#c08040","#50b050","#6888c8",
];

async function onResultsTabLoad() {
  populateAnalysisSelects();
  await loadResults();
}

async function loadResults() {
  const analysisId = getSelectedAnalysis("results") || "default";
  const morphSel   = document.getElementById("results-morph-filter");
  const morphFilter = morphSel?.value || "";
  const tbody = document.getElementById("results-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';

  try {
    const [summary, rawCells] = await Promise.all([
      apiJSON(`/api/results/summary?analysis_id=${encodedPath(analysisId)}`).catch(() => []),
      apiJSON(`/api/results/chart-data?analysis_id=${encodedPath(analysisId)}`).catch(() => []),
    ]);

    // Populate morphotype filter with morphotypes present in the data
    if (morphSel) {
      const current = morphSel.value;
      const morphtypes = [...new Set(rawCells.map(c => c.morphotype))]
        .filter(m => m !== "rejected").sort();
      morphSel.innerHTML = '<option value="">All (excl. rejected)</option>';
      morphtypes.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
        morphSel.appendChild(opt);
      });
      if (current && morphtypes.includes(current)) morphSel.value = current;
    }

    // Filter cells: exclude rejected, optionally filter by morphotype
    const cells = rawCells.filter(c => {
      if (c.morphotype === "rejected") return false;
      if (morphFilter && c.morphotype !== morphFilter) return false;
      return true;
    });

    // Summary table (now includes morphotype column)
    if (!summary.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No curated data — run Measure + Curate first.</td></tr>';
    } else {
      // Filter summary rows by active morphotype filter
      const visibleRows = morphFilter
        ? summary.filter(r => r.morphotype === morphFilter)
        : summary;
      tbody.innerHTML = visibleRows.map(row => `
        <tr>
          <td>${row.strain}</td>
          <td>${row.morphotype ?? "—"}</td>
          <td class="r">${row.n_cells}</td>
          <td class="r">${fmtMeanSd(row.length_um_mean, row.length_um_sd)}</td>
          <td class="r">${fmtMeanSd(row.breadth_um_mean, row.breadth_um_sd)}</td>
          <td class="r">${row.feret_max_um_mean != null ? row.feret_max_um_mean.toFixed(2) : "—"}</td>
          <td class="r">${row.feret_min_um_mean != null ? row.feret_min_um_mean.toFixed(2) : "—"}</td>
          <td class="r">${row.aspect_ratio_mean != null ? row.aspect_ratio_mean.toFixed(3) : "—"}</td>
        </tr>
      `).join("");
    }

    if (cells.length) renderResultsCharts(cells);

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Error: ${e.message}</td></tr>`;
  }
}

function renderResultsCharts(cells) {
  const strains    = [...new Set(cells.map(c => c.strain))].sort();
  const morphotypes = [...new Set(cells.map(c => c.morphotype))].sort();

  // Color by morphotype; fall back to coloring by strain when only one morphotype
  const colorKeys  = morphotypes.length > 1 ? morphotypes : strains;
  const colorMap   = Object.fromEntries(colorKeys.map((k, i) => [k, STRAIN_COLORS[i % STRAIN_COLORS.length]]));
  const getColor   = (c) => morphotypes.length > 1 ? colorMap[c.morphotype] : colorMap[c.strain];
  const seriesKey  = (c) => morphotypes.length > 1 ? c.morphotype : c.strain;

  const METRICS = [
    { key: "length_um",      canvasId: "canvas-length",    label: "Length (µm)" },
    { key: "breadth_um",     canvasId: "canvas-breadth",   label: "Breadth (µm)" },
    { key: "aspect_ratio",   canvasId: "canvas-ar",        label: "Aspect Ratio" },
    { key: "area_um2",       canvasId: "canvas-area",      label: "Area (µm²)" },
    { key: "feret_max_um",   canvasId: "canvas-feret-max", label: "Feret Max (µm)" },
    { key: "feret_min_um",   canvasId: "canvas-feret-min", label: "Feret Min (µm)" },
    { key: "solidity",       canvasId: "canvas-solidity",  label: "Solidity" },
  ];

  const cc = getChartColors();
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: {
        labels: {
          color: cc.textMid,
          font: { family: "'Share Tech Mono', monospace", size: 11 },
          boxWidth: 12,
          filter: (item) => !item.text.endsWith(" mean"),
        }
      },
      tooltip: {
        backgroundColor: cc.stoneMid,
        borderColor: cc.stoneBorder,
        borderWidth: 1,
        titleColor: cc.textBright,
        bodyColor: cc.textMid,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3) ?? ctx.parsed.x?.toFixed(3) ?? ""}` }
      }
    },
    scales: {
      x: { ticks: { color: cc.textDim }, grid: { color: cc.stoneBorder + "55" } },
      y: { ticks: { color: cc.textDim }, grid: { color: cc.stoneBorder + "55" } },
    }
  };

  // Strip/dot plots: X position = strain, color = morphotype (or strain when 1 morphotype)
  METRICS.forEach(({ key, canvasId }) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (_charts[canvasId]) { _charts[canvasId].destroy(); delete _charts[canvasId]; }

    const datasets = colorKeys.map(sk => {
      const skCells = cells.filter(c => seriesKey(c) === sk && c[key] != null);
      const jitter  = 0.25;
      return {
        label: sk,
        data: skCells.map(c => ({
          x: strains.indexOf(c.strain) + (Math.random() - 0.5) * jitter,
          y: c[key],
        })),
        backgroundColor: colorMap[sk] + "aa",
        borderColor: "transparent",
        pointRadius: 4,
        pointHoverRadius: 6,
      };
    });

    // Mean lines: one per strain+seriesKey combo
    const meanDatasets = [];
    strains.forEach((strain, si) => {
      colorKeys.forEach(sk => {
        const vals = cells.filter(c =>
          c.strain === strain && seriesKey(c) === sk && c[key] != null
        ).map(c => c[key]);
        if (!vals.length) return;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        meanDatasets.push({
          label: `${sk} mean`,
          data: [{ x: si - 0.28, y: mean }, { x: si + 0.28, y: mean }],
          type: "line",
          borderColor: colorMap[sk],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          fill: false,
        });
      });
    });

    _charts[canvasId] = new Chart(canvas, {
      type: "scatter",
      data: { datasets: [...datasets, ...meanDatasets] },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          x: {
            ...chartDefaults.scales.x,
            min: -0.5, max: strains.length - 0.5,
            ticks: {
              color: "#a8926a",
              callback: (val) => {
                const i = Math.round(val);
                return (i >= 0 && i < strains.length) ? strains[i] : "";
              },
              stepSize: 1,
            }
          }
        }
      }
    });
  });

  // Scatter: length vs breadth, colored by morphotype (or strain)
  const scatterCanvas = document.getElementById("canvas-scatter");
  if (scatterCanvas) {
    if (_charts["canvas-scatter"]) { _charts["canvas-scatter"].destroy(); delete _charts["canvas-scatter"]; }
    const scatterDatasets = colorKeys.map(sk => ({
      label: sk,
      data: cells.filter(c => seriesKey(c) === sk && c.length_um != null && c.breadth_um != null)
                 .map(c => ({ x: c.length_um, y: c.breadth_um })),
      backgroundColor: colorMap[sk] + "aa",
      pointRadius: 5,
    }));
    _charts["canvas-scatter"] = new Chart(scatterCanvas, {
      type: "scatter",
      data: { datasets: scatterDatasets },
      options: {
        ...chartDefaults,
        scales: {
          x: { ...chartDefaults.scales.x, title: { display: true, text: "Length (µm)", color: cc.textDim } },
          y: { ...chartDefaults.scales.y, title: { display: true, text: "Breadth (µm)", color: cc.textDim } },
        }
      }
    });
  }
}

function fmtMeanSd(mean, sd) {
  if (mean == null) return "—";
  return `${mean.toFixed(2)} ± ${sd != null ? sd.toFixed(2) : "—"}`;
}

function initResultsTab() {
  document.getElementById("refresh-results-btn")?.addEventListener("click", loadResults);
  document.getElementById("analysis-select-results")?.addEventListener("change", loadResults);
  document.getElementById("results-morph-filter")?.addEventListener("change", loadResults);

  document.getElementById("download-cells-btn")?.addEventListener("click", () => {
    const analysisId = getSelectedAnalysis("results") || "default";
    window.location.href = `/api/results/download/cells?analysis_id=${encodedPath(analysisId)}`;
  });

  document.getElementById("build-excel-btn")?.addEventListener("click", async () => {
    const analysisId = getSelectedAnalysis("results") || "default";
    const btn = document.getElementById("build-excel-btn");
    const statusEl = document.getElementById("excel-status");
    const dlBtn = document.getElementById("download-excel-btn");
    btn.disabled = true; btn.textContent = "Building…";
    statusEl.classList.remove("hidden"); statusEl.textContent = "Building Excel…";
    try {
      const result = await postJSON(`/api/results/build-excel?analysis_id=${encodedPath(analysisId)}`, {});
      statusEl.textContent = "Excel built successfully.";
      dlBtn.classList.remove("hidden");
      dlBtn.onclick = () => {
        window.location.href = `/api/results/download/excel?analysis_id=${encodedPath(analysisId)}`;
      };
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = "Build Excel";
    }
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function _cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getChartColors() {
  return {
    textMid:     _cssVar("--text-mid")     || "#a8926a",
    textDim:     _cssVar("--text-dim")     || "#6a5840",
    textBright:  _cssVar("--text-bright")  || "#e8d8a8",
    stoneMid:    _cssVar("--stone-mid")    || "#28241e",
    stoneBorder: _cssVar("--stone-border") || "#4a4238",
    stoneVoid:   _cssVar("--stone-void")   || "#0e0c0a",
  };
}

function _updateThemeBtn(theme) {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  btn.textContent = theme === "dark" ? "☀" : "☾";
  btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function initTheme() {
  function _apply(theme) {
    document.documentElement.dataset.theme = theme;
    _updateThemeBtn(theme);
  }
  const saved = localStorage.getItem("morpheus-theme");
  _apply(saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
    if (!localStorage.getItem("morpheus-theme"))
      _apply(e.matches ? "light" : "dark");
  });

  document.getElementById("theme-toggle-btn")?.addEventListener("click", () => {
    const next = (document.documentElement.dataset.theme || "dark") === "dark" ? "light" : "dark";
    localStorage.setItem("morpheus-theme", next);
    _apply(next);
    if (Object.keys(_charts).length) loadResults();
  });
}

// ── Test dataset ──────────────────────────────────────────────────────────────

async function loadTestDataStatus() {
  try {
    const status = await apiJSON("/api/test-data/status");
    renderTestDataActions(status);
  } catch (e) {
    const el = document.getElementById("test-data-actions");
    if (el) el.innerHTML = '<span class="text-dim" style="font-size:11px">—</span>';
  }
}

function renderTestDataActions(status) {
  const el = document.getElementById("test-data-actions");
  if (!el) return;
  if (status.active) {
    el.innerHTML = `
      <span class="chip">${status.n_cells} cells</span>
      <button id="remove-test-data-btn" class="btn-danger btn-sm">Remove Test Data</button>
    `;
    const btn = document.getElementById("remove-test-data-btn");
    btn.addEventListener("click", async () => {
      try { await confirmBtn(btn, "Remove all — sure?", 4000); } catch { return; }
      btn.disabled = true; btn.textContent = "Removing…";
      const statusEl = document.getElementById("test-data-status");
      try {
        await apiFetch("/api/test-data", { method: "DELETE" });
        state.config = await apiJSON("/api/config");
        await loadStrains();
        await loadAnalyses();
        populateAnalysisSelects();
        await loadTestDataStatus();
        if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Test data removed."; }
      } catch (e) {
        if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = `Error: ${e.message}`; }
        btn.disabled = false; btn.textContent = "Remove Test Data";
      }
    });
  } else {
    el.innerHTML = `<button id="load-test-data-btn" class="btn-primary btn-sm">Load Test Dataset</button>`;
    document.getElementById("load-test-data-btn").addEventListener("click", async () => {
      const btn = document.getElementById("load-test-data-btn");
      const statusEl = document.getElementById("test-data-status");
      btn.disabled = true; btn.textContent = "Loading…";
      try {
        await postJSON("/api/test-data/load", {});
        state.config = await apiJSON("/api/config");
        await loadStrains();
        await loadAnalyses();
        populateAnalysisSelects();
        await loadTestDataStatus();
        if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Test dataset loaded. Open Curate or Results to explore."; }
      } catch (e) {
        if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = `Error: ${e.message}`; }
        btn.disabled = false; btn.textContent = "Load Test Dataset";
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  initTheme();
  initTabs();
  initObjectives();
  initSetupTab();
  initSelectTab();
  initTrainTab();
  initMeasureTab();
  initCurateTab();
  initResultsTab();

  await loadConfig();
  populateAnalysisSelects();

  // Load setup tab data
  await loadStrains();
  await loadAnalyses();
  await loadModels();
  await loadObjectives();
  loadEnvStatus();        // non-blocking — runs subprocess check in background
  loadTestDataStatus();   // non-blocking
}

document.addEventListener("DOMContentLoaded", init);
