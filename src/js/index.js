/**
 * DNT-IVB mapping Plugin for MINERVA v18+
 * Author: Luiz Ladeira
 *
 * Loads a Google Sheet describing Developmental Neurotoxicity (DNT)
 * In-Vitro Battery (IVB) assays and their mapping to MINERVA map
 * elements. Rows are anchored on the `Element_id` column: each row is
 * matched to a BioEntity in the map by its numeric element id, and the
 * corresponding element is highlighted / focused when the row is clicked.
 *
 * Attribution:
 *  - Repurposed from the Cardiotox AOP / KE Methods Mapper plugin, itself
 *    based on previous development by Hesam Korki
 *    (https://github.com/HesamKorki).
 *  - The compact expandable-row layout (narrow primary columns with the
 *    remaining fields in a per-row detail panel) is adapted from the MINERVA
 *    Adverse Drug Reactions (drug-reactions) plugin
 *    (https://gitlab.com/uniluxembourg/lcsb/BioCore/minerva/plugins/drug-reactions).
 */

let $ = require("jquery");
require("../css/styles.css");
require("./minervaAPI");

/* globals minerva:MinervaAPI */

// ===== Configuration =====
const PLUGIN_NAME = "DNT-IVB mapping";
const PLUGIN_VERSION = "0.3";
const PLUGIN_URL =
  "https://raw.githubusercontent.com/luiz-ladeira/DNT-IVB_mapping_minerva_plugin/master/plugin.js";

const SPREADSHEET_ID = "1bxuDsq2Wbf6ijzaOeDhW0u8qvhEnDqqFsVPDzrWhrbE";
const SHEET_TAB = "data";
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
// Keyless public export (Google Visualization API). The sheet must be shared
// as "anyone with the link can view". No API key is embedded — this avoids
// shipping a secret in client-side code.
const SHEET_GVIZ_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq` +
  `?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}`;

// Anchor column: rows are mapped to map elements by this numeric id.
const ELEMENT_ID_COLUMN = "Element_id";
const MODEL_ID_COLUMN = "model_id";

// Column treated as a DOI -> rendered as a hyperlink.
const DOI_COLUMN = "Reference";

// Columns offered as dropdown filters (only used if present in the sheet).
const FILTER_COLUMNS = ["Relevance_(submap)", "Regulatory_status", "Entity"];

// Columns used only for mapping, hidden from the displayed table.
const HIDDEN_COLUMNS = ["Element_id", "model_id"];

// Primary (always-visible) columns shown as narrow table columns. Every other
// non-hidden column is moved into an expandable detail panel below each row,
// so the table needs no horizontal scrolling. Columns are matched by name;
// any not present are skipped, and any extra sheet columns not listed here
// automatically land in the detail panel.
const PRIMARY_COLUMNS = ["Assay", "Entity", "Regulatory_status"];

// Placeholder tokens used in the sheet for "not mapped".
const EMPTY_TOKENS = new Set(["", "/", "a", "n/a", "na", "-"]);

const HIGHLIGHT_COLOR = "#d6336c";

// Reclaim the vertical space taken by MINERVA's own plugin-drawer header
// (the "Plugin: … / Open new plugin" block that sits above the plugin's
// container). This is host chrome, not part of the plugin's element, so we
// hide it via a best-effort DOM tweak that fails silently if MINERVA's
// layout differs. Set to false to leave MINERVA's header untouched.
const HIDE_HOST_CHROME = true;

// Record of every inline-style change we make to MINERVA's own DOM (host
// chrome we hide, the .tab-content we position). Restored verbatim when the
// plugin is unloaded, so closing the plugin leaves MINERVA exactly as it was
// and its panel can collapse normally.
let hostMutations = [];

function recordHostStyle(el, prop) {
  hostMutations.push({ el: el, prop: prop, prev: el.style[prop] });
}

function restoreHost() {
  hostMutations.forEach((m) => {
    try {
      m.el.style[m.prop] = m.prev;
    } catch (e) {
      /* element may be gone; ignore */
    }
  });
  hostMutations = [];
}

// ===== Utils =====
function isEmptyToken(v) {
  return EMPTY_TOKENS.has(String(v || "").trim().toLowerCase());
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function doiToUrl(doi) {
  const d = String(doi || "").trim();
  if (!d) return "";
  if (/^https?:\/\//i.test(d)) return d;
  return "https://doi.org/" + d.replace(/^doi:\s*/i, "");
}

/**
 * Index map elements by their numeric id (as string).
 * @param {Array} elements
 * @return {Object<string, Object>}
 */
function buildElementIndex(elements) {
  const index = {};
  (elements || []).forEach((el) => {
    if (el && el.id != null) {
      index[String(el.id)] = el;
    }
  });
  return index;
}

/**
 * Fetch the sheet via the keyless gviz JSON export and normalise it into the
 * same { values: [ [header...], [row...], ... ] } shape the rest of the code
 * expects. Trailing phantom columns (gviz pads to the sheet's grid width) are
 * trimmed to the last labelled/non-empty column, so adding or removing
 * columns in the sheet is picked up automatically.
 */
async function fetchSheetData() {
  const resp = await fetch(SHEET_GVIZ_URL, { credentials: "omit" });
  if (!resp.ok) throw new Error(`Google Sheets fetch failed: ${resp.statusText}`);
  const text = await resp.text();

  // gviz wraps the JSON, e.g. "/*O_o*/\ngoogle.visualization.Query.setResponse({...});"
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Unexpected Google Sheets response format");
  const payload = JSON.parse(text.slice(start, end + 1));

  const table = payload.table || {};
  const cols = table.cols || [];
  const gRows = table.rows || [];

  const cellString = (c) => {
    if (!c) return "";
    if (c.f != null) return String(c.f); // formatted value (clean ints, dates)
    if (c.v != null) return String(c.v);
    return "";
  };

  // Build the header from column labels.
  const header = cols.map((c) => (c && c.label != null ? String(c.label).trim() : ""));

  // Determine how many columns are actually in use: the widest of
  // (labelled header columns) and (columns with any non-empty cell). This
  // trims gviz's phantom trailing empty columns while keeping every real one.
  let lastUsed = -1;
  header.forEach((h, i) => {
    if (h !== "") lastUsed = Math.max(lastUsed, i);
  });
  gRows.forEach((r) => {
    const cells = (r && r.c) || [];
    for (let i = 0; i < cells.length; i += 1) {
      if (cellString(cells[i]) !== "") lastUsed = Math.max(lastUsed, i);
    }
  });
  const width = lastUsed + 1;

  const values = [header.slice(0, width)];
  gRows.forEach((r) => {
    const cells = (r && r.c) || [];
    const row = [];
    for (let i = 0; i < width; i += 1) row.push(cellString(cells[i]));
    values.push(row);
  });

  return { values };
}

/**
 * @param {Object} element
 * @return {Object} marker
 */
function elementToPinData(element) {
  const geo = element.bounds ? element.bounds : element;
  const w = parseFloat(geo.width) || 0;
  const h = parseFloat(geo.height) || 0;
  const x = parseFloat(geo.x) || 0;
  const y = parseFloat(geo.y) || 0;
  return {
    id: "E" + element.id,
    modelId: element.modelId != null ? element.modelId : element.model,
    type: "pin",
    color: HIGHLIGHT_COLOR,
    opacity: 0.9,
    x: x + w / 2,
    y: y + h / 2,
  };
}

function deHighlightAll() {
  try {
    if (minerva && minerva.data && minerva.data.bioEntities) {
      minerva.data.bioEntities.removeAllMarkers();
    }
  } catch (e) {
    console.error("removeAllMarkers failed", e);
  }
}

function highlightMultiple(elements) {
  deHighlightAll();
  (elements || []).forEach((el) => {
    try {
      const marker = elementToPinData(el);
      if (!isNaN(marker.x) && !isNaN(marker.y)) {
        minerva.data.bioEntities.addSingleMarker(marker);
      }
    } catch (err) {
      console.error("Error highlighting", el, err);
    }
  });
}

/**
 * Open the submap the element belongs to and zoom to it.
 */
function focusOnElement(element) {
  try {
    const modelId = element.modelId != null ? element.modelId : element.model;
    if (modelId != null && minerva.map && minerva.map.openMap) {
      minerva.map.openMap({ id: modelId });
    }
    const geo = element.bounds ? element.bounds : element;
    const w = parseFloat(geo.width) || 0;
    const h = parseFloat(geo.height) || 0;
    const x = parseFloat(geo.x) || 0;
    const y = parseFloat(geo.y) || 0;
    if (minerva.map && minerva.map.fitBounds) {
      const padX = w * 5 + 200;
      const padY = h * 5 + 200;
      minerva.map.fitBounds({
        x1: x - padX,
        y1: y - padY,
        x2: x + w + padX,
        y2: y + h + padY,
      });
    }
  } catch (e) {
    console.error("focus failed", e);
  }
}

/**
 * Best-effort: hide MINERVA's plugin-drawer header (the "Plugin: … /
 * Open new plugin" block) that sits above the plugin container, so the
 * plugin gets that vertical space. Never throws; hides nothing if the
 * expected structure isn't found.
 *
 * NOTE: MINERVA's in-drawer refresh (\u21BB) and close (\u2715) controls live in
 * that header, so hiding it removes them from the panel. The plugin can
 * still be closed/reopened from MINERVA's main Plugins menu.
 *
 * @param {HTMLElement} myEl - the plugin's own container element.
 */
function hideHostChrome(myEl) {
  try {
    // Locate MINERVA's "Open new plugin" button.
    let btn = null;
    document.querySelectorAll("button, a").forEach((b) => {
      if (String(b.textContent || "").trim().toLowerCase() === "open new plugin") {
        btn = b;
      }
    });
    if (!btn) return false;

    // Climb from the button to the highest ancestor that still holds the
    // "Plugin:" title text but does NOT contain our own plugin content
    // (so we never hide the plugin itself).
    let node = btn.parentElement;
    let header = null;
    let hops = 0;
    while (node && hops < 10) {
      if (node.contains(myEl)) break;
      if (/plugin:/i.test(node.textContent || "")) header = node;
      node = node.parentElement;
      hops += 1;
    }

    const target = header && !header.contains(myEl) ? header : btn.parentElement;
    if (target && !target.contains(myEl)) {
      recordHostStyle(target, "display");
      target.style.display = "none";
      return true;
    }
    // Fallback: at least hide the button itself.
    recordHostStyle(btn, "display");
    btn.style.display = "none";
    return true;
  } catch (e) {
    console.warn("hideHostChrome skipped:", e);
    return false;
  }
}

// Small gap (px) left between the panel's bottom edge and the bottom of the
// viewport, so the panel never sits flush against the window edge.
const PANEL_BOTTOM_GAP = 4;

/**
 * Make the panel fill MINERVA's plugin space with no dead gap below — using an
 * overlay strategy rather than trying to grow MINERVA's own boxes.
 *
 * MINERVA gives each plugin a mount element with a fixed height. When we hide
 * the drawer header we reclaim space at the top, but MINERVA keeps the drawer
 * the same total height, so an equal blank strip appears BELOW the mount that
 * no height cascade on the mount can reach. Instead we lift our container out
 * of the flow with `position: fixed`, anchor it to where the plugin content
 * starts, and stretch it down to the bottom of the viewport — so it lies over
 * the blank space and fills it. The container's flex column + the table
 * wrapper's own scroll then use the full height.
 *
 * Geometry is recomputed on scroll/resize (see renderUI). The container's
 * top/left/width are captured from the mount BEFORE it is taken out of flow,
 * and the horizontal box is re-read from the drawer (which stays in flow) on
 * every recompute so the panel tracks the drawer if the window is resized.
 * All mutations are recorded and restored on unload. Never throws.
 *
 * @param {HTMLElement} rootEl - the plugin's own container element (.dnt-container).
 */
function fillPanelHeight(rootEl) {
  try {
    const mount = rootEl.parentElement || rootEl;

    // A zero-height marker left IN THE FLOW at the plugin's start position.
    // The container itself goes out of flow (position: fixed), so it can no
    // longer report where the plugin begins; the marker can. It moves up when
    // the host header is hidden and tracks the drawer on window resize, so
    // reading its rect each recompute gives the live top / left / width.
    if (!renderUI._anchorEl) {
      const a = document.createElement("div");
      a.className = "dnt-anchor";
      a.style.cssText = "height:0;margin:0;padding:0;border:0;width:100%;";
      mount.insertBefore(a, mount.firstChild);
      renderUI._anchorEl = a;
      // Record the container's originals so restoreHost() reverts them.
      ["position", "top", "left", "width", "height", "zIndex"].forEach((p) =>
        recordHostStyle(rootEl, p)
      );
    }

    const a = renderUI._anchorEl.getBoundingClientRect();
    const top = a.top;
    const left = a.left;
    const width = a.width || rootEl.getBoundingClientRect().width;
    const height = Math.max(160, window.innerHeight - top - PANEL_BOTTOM_GAP);

    // Overlay: lift the panel out of the flow and stretch it from the plugin's
    // start down to the bottom of the viewport, covering MINERVA's blank strip.
    rootEl.style.position = "fixed";
    rootEl.style.top = top + "px";
    rootEl.style.left = left + "px";
    rootEl.style.width = width + "px";
    rootEl.style.height = height + "px";
    rootEl.style.zIndex = "5";
  } catch (e) {
    console.warn("fillPanelHeight skipped:", e);
  }
}

// ===== UI =====
function renderUI(container, sheet, elements) {
  const $host = $(container);
  $host.empty();

  const values = (sheet && sheet.values) || [];
  if (values.length === 0) {
    $host.html('<p style="color:#b00;">No data found in the sheet.</p>');
    return;
  }

  const header = values[0];
  const rows = values.slice(1).filter((r) => r && r.some((c) => String(c || "").trim() !== ""));

  const elemIdx = header.indexOf(ELEMENT_ID_COLUMN);
  const modelIdx = header.indexOf(MODEL_ID_COLUMN);
  const doiIdx = header.indexOf(DOI_COLUMN);
  const elementIndex = buildElementIndex(elements);

  // Resolve the map element for each row (null if not mapped).
  const rowElement = rows.map((row) => {
    if (elemIdx === -1) return null;
    const rawId = row[elemIdx];
    if (isEmptyToken(rawId)) return null;
    const el = elementIndex[String(rawId).trim()];
    return el || null;
  });

  const nMapped = rowElement.filter(Boolean).length;

  // ----- Shell -----
  const $root = $('<div class="dnt-container"></div>');

  const $bar = $(`
    <div class="dnt-header">
      <div class="dnt-title">
        <span class="dnt-title-main">DNT&#8209;IVB mapping</span>
        <span class="dnt-badge-version">v${PLUGIN_VERSION}</span>
      </div>
      <div class="dnt-actions">
        <button type="button" class="dnt-btn dnt-btn-primary dnt-access">Access data</button>
        <button type="button" class="dnt-btn dnt-btn-ghost dnt-clean">Clean</button>
      </div>
    </div>
  `);

  const $controls = $('<div class="dnt-controls"></div>');
  const $search = $(
    '<input type="text" class="dnt-search" placeholder="Search assays, entities, cell models\u2026">'
  );
  $controls.append($search);

  // Dropdown filters
  const filterDefs = [];
  const $filters = $('<div class="dnt-filters"></div>');
  FILTER_COLUMNS.forEach((col) => {
    const ci = header.indexOf(col);
    if (ci === -1) return;
    const seen = [];
    rows.forEach((r) => {
      const v = String(r[ci] == null ? "" : r[ci]).trim();
      if (v && !isEmptyToken(v) && seen.indexOf(v) === -1) seen.push(v);
    });
    if (seen.length === 0) return;
    seen.sort((a, b) => a.localeCompare(b));
    const label = col.replace(/_/g, " ").replace(/\((.*)\)/, "($1)");
    const $sel = $(
      `<select class="dnt-filter" data-col="${ci}"><option value="">${escapeHtml(label)}: all</option></select>`
    );
    seen.forEach((v) => $sel.append(`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
    $filters.append($sel);
    filterDefs.push({ ci, $sel });
  });
  if (filterDefs.length) $controls.append($filters);

  const $count = $(
    `<div class="dnt-count"><span class="dnt-count-val">${rows.length}</span> assays &middot; <span class="dnt-mapped-val">${nMapped}</span> mapped to the map</div>`
  );

  // Columns hidden from display (still read from the row for mapping/search).
  const hiddenIdx = new Set(
    HIDDEN_COLUMNS.map((c) => header.indexOf(c)).filter((i) => i !== -1)
  );

  // Split the visible columns into "primary" (narrow, shown as table columns)
  // and "detail" (everything else, shown in an expandable panel below the
  // row). Primary columns keep the order given in PRIMARY_COLUMNS; detail
  // columns keep their sheet order. This is what avoids horizontal scrolling.
  const primaryIdx = [];
  PRIMARY_COLUMNS.forEach((c) => {
    const ci = header.indexOf(c);
    if (ci !== -1 && !hiddenIdx.has(ci)) primaryIdx.push(ci);
  });
  const primarySet = new Set(primaryIdx);
  const detailIdx = [];
  header.forEach((h, ci) => {
    if (hiddenIdx.has(ci) || primarySet.has(ci)) return;
    detailIdx.push(ci);
  });

  // Total column count (dot + expand toggle + primary columns) for detail-row
  // colspan.
  const colCount = 2 + primaryIdx.length;

  const cellContent = (ci, row) => {
    const raw = ci < row.length ? row[ci] : "";
    if (ci === doiIdx && !isEmptyToken(raw)) {
      const href = doiToUrl(raw);
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="dnt-doi">${escapeHtml(raw)}</a>`;
    }
    return escapeHtml(raw);
  };

  // ----- Table -----
  const $wrapper = $('<div class="dnt-table-wrapper"></div>');
  const $table = $('<table class="dnt-table"></table>');
  const $thead = $("<thead></thead>");
  const $htr = $("<tr></tr>");
  $htr.append('<th class="dnt-th-pin" title="Mapped to map element"></th>');
  $htr.append('<th class="dnt-th-exp" title="Show details"></th>');
  primaryIdx.forEach((ci) => {
    $htr.append(`<th>${escapeHtml(header[ci].replace(/_/g, " "))}</th>`);
  });
  $thead.append($htr);
  const $tbody = $("<tbody></tbody>");

  const $rows = [];
  rows.forEach((row, ri) => {
    const el = rowElement[ri];
    const $tr = $('<tr class="dnt-main-row"></tr>');
    if (ri % 2 === 1) $tr.addClass("dnt-stripe");
    $tr.attr("data-mapped", el ? "1" : "0");

    // pin indicator cell: green filled dot = mapped, red filled dot = not
    // mapped. Native title tooltip shows "Mapped" / "Not mapped" on hover.
    $tr.append(
      el
        ? '<td class="dnt-pin-cell dnt-pin-mapped" title="Mapped">\u25CF</td>'
        : '<td class="dnt-pin-cell dnt-pin-off" title="Not mapped">\u25CF</td>'
    );

    // expand toggle
    const hasDetail = detailIdx.some((ci) => !isEmptyToken(ci < row.length ? row[ci] : ""));
    const $exp = $(
      `<td class="dnt-exp-cell">${hasDetail ? '<span class="dnt-exp-icon">\u25B6</span>' : ""}</td>`
    );
    $tr.append($exp);

    primaryIdx.forEach((ci) => {
      $tr.append(`<td>${cellContent(ci, row)}</td>`);
    });

    // detail row (hidden until expanded)
    const $detail = $('<tr class="dnt-detail-row" style="display:none;"></tr>');
    const $detailCell = $(`<td colspan="${colCount}"></td>`);
    const $panel = $('<div class="dnt-detail-panel"></div>');
    detailIdx.forEach((ci) => {
      const raw = ci < row.length ? row[ci] : "";
      if (isEmptyToken(raw) && ci !== doiIdx) {
        $panel.append(
          `<div class="dnt-detail-item"><span class="dnt-detail-label">${escapeHtml(
            header[ci].replace(/_/g, " ")
          )}:</span> <span class="dnt-detail-val dnt-detail-empty">&mdash;</span></div>`
        );
      } else {
        $panel.append(
          `<div class="dnt-detail-item"><span class="dnt-detail-label">${escapeHtml(
            header[ci].replace(/_/g, " ")
          )}:</span> <span class="dnt-detail-val">${cellContent(ci, row)}</span></div>`
        );
      }
    });
    $detailCell.append($panel);
    $detail.append($detailCell);

    let expanded = false;
    const toggleDetail = () => {
      if (!hasDetail) return;
      expanded = !expanded;
      $detail.toggle(expanded);
      $exp.find(".dnt-exp-icon").text(expanded ? "\u25BC" : "\u25B6");
      $tr.toggleClass("dnt-expanded", expanded);
    };
    $exp.on("click", (ev) => {
      ev.stopPropagation();
      toggleDetail();
    });

    if (el) {
      $tr.addClass("dnt-clickable");
      $tr.on("click", (ev) => {
        if ($(ev.target).is("a")) return; // let DOI links work
        if ($(ev.target).closest(".dnt-exp-cell").length) return; // toggle handled separately
        $tbody.find("tr").removeClass("dnt-active");
        $tr.addClass("dnt-active");
        highlightMultiple([el]);
        focusOnElement(el);
      });
    }
    $tbody.append($tr);
    $tbody.append($detail);
    $rows.push({ $tr, $detail, el, text: row.join(" \u0001 ").toLowerCase(), row });
  });

  $table.append($thead).append($tbody);
  $wrapper.append($table);

  $root.append($bar, $controls, $count, $wrapper);
  $host.append($root);

  // ----- Behaviour -----
  function applyFilters() {
    const q = String($search.val() || "").toLowerCase().trim();
    const active = [];
    let shown = 0;
    let shownMapped = 0;
    $rows.forEach((rec) => {
      let visible = q === "" || rec.text.indexOf(q) !== -1;
      if (visible) {
        for (const f of filterDefs) {
          const want = String(f.$sel.val() || "");
          if (want) {
            const cell = String(rec.row[f.ci] == null ? "" : rec.row[f.ci]).trim();
            if (cell !== want) {
              visible = false;
              break;
            }
          }
        }
      }
      rec.$tr.toggle(visible);
      // Hidden main rows must also hide (and collapse) their detail row.
      if (!visible && rec.$detail) {
        rec.$detail.hide();
        rec.$tr.removeClass("dnt-expanded");
        rec.$tr.find(".dnt-exp-icon").text("\u25B6");
      }
      if (visible) {
        shown += 1;
        if (rec.el) {
          shownMapped += 1;
          active.push(rec.el);
        }
      }
    });
    $count.find(".dnt-count-val").text(shown);
    $count.find(".dnt-mapped-val").text(shownMapped);
    highlightMultiple(active);
  }

  $search.on("input", applyFilters);
  filterDefs.forEach((f) => f.$sel.on("change", applyFilters));

  $bar.find(".dnt-access").on("click", () => window.open(SPREADSHEET_URL, "_blank"));
  $bar.find(".dnt-clean").on("click", () => {
    $search.val("");
    filterDefs.forEach((f) => f.$sel.val(""));
    $tbody.find("tr").removeClass("dnt-active");
    // Collapse any expanded detail rows.
    $rows.forEach((rec) => {
      if (rec.$detail) {
        rec.$detail.hide();
        rec.$tr.removeClass("dnt-expanded");
        rec.$tr.find(".dnt-exp-icon").text("\u25B6");
      }
    });
    applyFilters();
  });

  const myEl = $root.get(0);

  // Reclaim MINERVA's header space (best-effort, with a few retries since
  // the host chrome can render slightly after the plugin container), then
  // re-fit the panel height so the reclaimed space is used.
  if (HIDE_HOST_CHROME) {
    let tries = 0;
    const tick = () => {
      const done = hideHostChrome(myEl);
      tries += 1;
      fillPanelHeight(myEl);
      if (!done && tries < 8) setTimeout(tick, 250);
    };
    tick();
  }

  // Overlay the panel across MINERVA's blank strip and size it to the viewport
  // bottom. Re-run after layout settles (the header-hide shifts the anchor)
  // and on window resize so the panel keeps tracking the drawer.
  fillPanelHeight(myEl);
  setTimeout(() => fillPanelHeight(myEl), 300);
  setTimeout(() => fillPanelHeight(myEl), 800);
  if (renderUI._resizeHandler) {
    window.removeEventListener("resize", renderUI._resizeHandler);
  }
  renderUI._resizeHandler = () => fillPanelHeight(myEl);
  window.addEventListener("resize", renderUI._resizeHandler);

  // Initial state: highlight all mapped elements.
  highlightMultiple(rowElement.filter(Boolean));
}

// ===== Registration =====
function register() {
  if (!minerva || !minerva.plugins || !minerva.plugins.registerPlugin) {
    alert("MINERVA version not supported. Required version 18.0 or later.");
    return;
  }

  const pluginData = minerva.plugins.registerPlugin({
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
    pluginUrl: PLUGIN_URL,
  });

  // On close, undo every change we made to MINERVA's own DOM (hidden host
  // chrome, the positioned .tab-content) and drop our resize handler. Without
  // this, hiding the host chrome leaves MINERVA unable to collapse its panel,
  // so closing the only open plugin leaves a blank panel behind.
  try {
    if (pluginData.events && pluginData.events.addListener) {
      pluginData.events.addListener("onPluginUnload", () => {
        restoreHost();
        deHighlightAll();
        if (renderUI._resizeHandler) {
          window.removeEventListener("resize", renderUI._resizeHandler);
          renderUI._resizeHandler = null;
        }
        // Remove the in-flow anchor marker and clear cached layout state so a
        // re-open re-initialises the overlay geometry from scratch.
        if (renderUI._anchorEl && renderUI._anchorEl.parentNode) {
          renderUI._anchorEl.parentNode.removeChild(renderUI._anchorEl);
        }
        renderUI._anchorEl = null;
      });
    }
  } catch (e) {
    console.warn("onPluginUnload registration skipped:", e);
  }

  const baseUrl = minerva.project.data.getApiUrls().baseApiUrl;
  const projectId = minerva.project.data.getProjectId();

  Promise.all([
    fetchSheetData(),
    fetch(`${baseUrl}/projects/${projectId}/models/*/bioEntities/elements/`).then((r) => r.json()),
  ])
    .then((results) => {
      renderUI(pluginData.element, results[0], results[1]);
    })
    .catch((err) => {
      $(pluginData.element).html(
        `<p style="color:#b00; padding:12px;">DNT-IVB mapping failed to load: ${escapeHtml(err.message)}</p>`
      );
    });
}

register();
