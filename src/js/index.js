/**
 * DNT-IVB mapping plugin for MINERVA (plugin API v18+; written for the
 * MINERVA 21.0.7 and 22.0.4 plugin APIs).
 * Author: Luiz Ladeira. License: MIT (see LICENSE).
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
// browserify-css runs with autoInject:false (package.json), so this is the CSS
// text. It is injected as a <style> inside the plugin container and therefore
// leaves the page together with the plugin on unload.
const STYLES = require("../css/styles.css");
// Single source of truth for the version: package.json.
const PKG_VERSION = require("../../package.json").version;

/* globals minerva */

// ===== Configuration =====
const PLUGIN_NAME = "DNT-IVB mapping";
const PLUGIN_VERSION = PKG_VERSION;
// MINERVA refuses to load the plugin unless this matches, character for
// character, the URL it was loaded from. Set at build time for other hosts:
//   PLUGIN_URL=https://example.org/plugin.js npm run build
const DEFAULT_PLUGIN_URL =
  "https://raw.githubusercontent.com/luiz-ladeira/DNT-IVB_mapping_minerva_plugin/master/plugin.js";
const PLUGIN_URL = process.env.PLUGIN_URL || DEFAULT_PLUGIN_URL;

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
const HIDE_HOST_CHROME = false;

// Record of every inline-style change we make to MINERVA's own DOM (host
// chrome we hide, the .tab-content we position). Restored verbatim when the
// plugin is unloaded, so closing the plugin leaves MINERVA exactly as it was
// and its panel can collapse normally.
let hostMutations = [];

function recordHostStyle(el, prop) {
  // Record only the first (original) value of each (element, property), so
  // repeated calls on resize cannot overwrite the value to restore.
  if (hostMutations.some((m) => m.el === el && m.prop === prop)) return;
  hostMutations.push({ el: el, prop: prop, prev: el.style[prop] });
}

function restoreHost() {
  hostMutations.slice().reverse().forEach((m) => {
    try {
      m.el.style[m.prop] = m.prev;
    } catch (e) {
      /* element may be gone; ignore */
    }
  });
  hostMutations = [];
}

// Plugin lifecycle state: set on unload so late async work (fetches, timers)
// does not render or draw markers after the plugin has been closed.
const lifecycle = {
  unloaded: false,
  timers: [],
  abort: typeof AbortController !== "undefined" ? new AbortController() : null,
};

function later(fn, ms) {
  const t = setTimeout(() => {
    if (!lifecycle.unloaded) fn();
  }, ms);
  lifecycle.timers.push(t);
  return t;
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

/**
 * Build a https://doi.org/ link from a DOI cell. Accepts "10.xxxx/...",
 * "doi:10.xxxx/..." and "https://(dx.)doi.org/10.xxxx/...". Anything that is
 * not a DOI returns "" and is rendered as plain text, so a sheet edit cannot
 * attach an arbitrary external link.
 */
function doiToUrl(doi) {
  const d = String(doi || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(d)) return "";
  return "https://doi.org/" + encodeURI(d);
}

/** A valid Element_id is a positive integer. */
function parseElementId(v) {
  const s = String(v == null ? "" : v).trim();
  return /^\d+$/.test(s) ? s : null;
}

/**
 * Normalise a map element from either source to one shape:
 *  - legacy REST /bioEntities/elements/: { id, modelId, bounds: {x,y,width,height} }
 *  - plugin API v22 minerva.elements.data.getAll(): { id, map, x, y, width, height }
 */
function normalizeElement(el) {
  const geo = el.bounds ? el.bounds : el;
  const modelId = el.map != null ? el.map : el.modelId != null ? el.modelId : el.model;
  return {
    id: el.id,
    modelId: modelId,
    x: parseFloat(geo.x) || 0,
    y: parseFloat(geo.y) || 0,
    width: parseFloat(geo.width) || 0,
    height: parseFloat(geo.height) || 0,
  };
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
      index[String(el.id)] = normalizeElement(el);
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
  const resp = await fetch(SHEET_GVIZ_URL, {
    credentials: "omit",
    signal: lifecycle.abort ? lifecycle.abort.signal : undefined,
  });
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

  // The anchor column is read from the raw value, not the formatted one, so a
  // number format with digit grouping (e.g. "126,254") cannot unmap rows.
  const anchorIdx = header.indexOf(ELEMENT_ID_COLUMN);
  const anchorString = (c) => {
    if (c && typeof c.v === "number" && Number.isInteger(c.v)) return String(c.v);
    return cellString(c);
  };

  const values = [header.slice(0, width)];
  gRows.forEach((r) => {
    const cells = (r && r.c) || [];
    const row = [];
    for (let i = 0; i < width; i += 1) {
      row.push(i === anchorIdx ? anchorString(cells[i]) : cellString(cells[i]));
    }
    values.push(row);
  });

  return { values };
}

/**
 * @param {Object} element
 * @return {Object} marker
 */
function elementToPinData(element) {
  return {
    id: "E" + element.id,
    modelId: element.modelId,
    type: "pin",
    color: HIGHLIGHT_COLOR,
    opacity: 0.9,
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

// Ids of the markers this plugin has added, so only our own tags are removed
// (removeAllMarkers would also clear markers placed by other plugins).
const ourMarkers = new Set();

function deHighlightAll() {
  const bio = minerva && minerva.data && minerva.data.bioEntities;
  if (!bio) return;
  if (typeof bio.removeSingleMarker === "function") {
    ourMarkers.forEach((id) => {
      try {
        bio.removeSingleMarker(id);
      } catch (e) {
        /* already gone */
      }
    });
  } else if (typeof bio.removeAllMarkers === "function") {
    try {
      bio.removeAllMarkers();
    } catch (e) {
      console.error("removeAllMarkers failed", e);
    }
  }
  ourMarkers.clear();
}

function highlightMultiple(elements) {
  deHighlightAll();
  if (lifecycle.unloaded) return;
  // Several assays can share one map element; MINERVA 22 throws when a marker
  // id is added twice, so add one marker per element.
  const seen = new Set();
  (elements || []).forEach((el) => {
    if (!el || seen.has(el.id)) return;
    seen.add(el.id);
    try {
      const marker = elementToPinData(el);
      if (!isNaN(marker.x) && !isNaN(marker.y)) {
        minerva.data.bioEntities.addSingleMarker(marker);
        ourMarkers.add(marker.id);
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
    const modelId = element.modelId;
    if (modelId != null && minerva.map && minerva.map.openMap) {
      minerva.map.openMap({ id: modelId });
    }
    const w = element.width;
    const h = element.height;
    const x = element.x;
    const y = element.y;
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

/**
 * Make the panel fill MINERVA's plugin space with no dead gap below.
 *
 * MINERVA absolutely-positions the plugin mount element inside its Bootstrap
 * `.tab-content` drawer. Without a positioned `.tab-content`, the mount is
 * sized against a further-out ancestor and overshoots, leaving blank space
 * under the table. Giving `.tab-content` `position: relative` makes it the
 * containing block, so the mount fills exactly the panel and our container's
 * CSS `height: 100%` + flex column resolves against it. This is the same
 * technique used by MINERVA's own drug-reactions plugin; flexbox then adapts
 * on resize with no pixel measurement. The mutation is recorded and restored
 * on unload. Best-effort and idempotent; never throws.
 *
 * @param {HTMLElement} rootEl - the plugin's own container element.
 */
function fillPanelHeight(rootEl) {
  try {
    // rootEl is .dnt-container; its parent is MINERVA's mount element.
    const mount = rootEl.parentElement || rootEl;
    const tabContent = $(mount).closest(".tab-content").get(0);
    if (tabContent) {
      if (window.getComputedStyle(tabContent).position === "static") {
        recordHostStyle(tabContent, "position");
        tabContent.style.position = "relative";
      }
    } else {
      // Fallback: no .tab-content found — at least give the mount a height so
      // the container's height:100% has something to resolve against.
      recordHostStyle(mount, "height");
      mount.style.height = "100%";
    }
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
  const doiIdx = header.indexOf(DOI_COLUMN);
  const elementIndex = buildElementIndex(elements);

  // Resolve the map element for each row (null if not mapped).
  const rowElement = rows.map((row) => {
    if (elemIdx === -1) return null;
    const rawId = row[elemIdx];
    if (isEmptyToken(rawId)) return null;
    const id = parseElementId(rawId);
    const el = id ? elementIndex[id] : null;
    if (!el && Object.keys(elementIndex).length > 0) {
      console.warn(`DNT-IVB mapping: Element_id "${rawId}" does not resolve to a map element`);
    }
    return el || null;
  });

  const nMapped = rowElement.filter(Boolean).length;

  // ----- Shell -----
  const $root = $('<div class="dnt-container"></div>');
  $root.append($("<style></style>").text(STYLES));
  renderUI._root = $root;

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
    const label = col.replace(/_/g, " ");
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
      if (href) {
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="dnt-doi">${escapeHtml(raw)}</a>`;
      }
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
  // highlight=false updates the table and the tally without placing tags.
  function applyFilters(highlight = true) {
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
    if (highlight) highlightMultiple(active);
    else deHighlightAll();
  }

  $search.on("input", applyFilters);
  filterDefs.forEach((f) => f.$sel.on("change", applyFilters));

  $bar.find(".dnt-access").on("click", () => window.open(SPREADSHEET_URL, "_blank", "noopener,noreferrer"));
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
    // Show every row again, but leave the map without tags.
    applyFilters(false);
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
      if (!done && tries < 8) later(tick, 250);
    };
    tick();
  }

  // Make the height:100% chain continuous up to MINERVA's scroll panel so the
  // panel fills its space with no dead gap below. Re-run after layout settles
  // and on window resize; flexbox does the adapting, so no pixel math.
  fillPanelHeight(myEl);
  later(() => fillPanelHeight(myEl), 300);
  if (renderUI._resizeHandler) {
    window.removeEventListener("resize", renderUI._resizeHandler);
  }
  renderUI._resizeHandler = () => fillPanelHeight(myEl);
  window.addEventListener("resize", renderUI._resizeHandler);

  // Initial state: highlight all mapped elements.
  highlightMultiple(rowElement.filter(Boolean));
}

// ===== Element loading =====
/**
 * Base URL of MINERVA's new API ("/minerva/new_api/"), with a trailing slash.
 * MINERVA 22 exposes it as getApiUrls().baseNewApiUrl; on older servers it is
 * derived from baseApiUrl ("/minerva/api" -> "/minerva/new_api/").
 */
function newApiBase() {
  const urls = (minerva.project && minerva.project.data && minerva.project.data.getApiUrls
    ? minerva.project.data.getApiUrls()
    : {}) || {};
  let base = urls.baseNewApiUrl;
  if (!base && urls.baseApiUrl) base = String(urls.baseApiUrl).replace(/\/api\/?$/, "/new_api/");
  if (!base) return null;
  return String(base).endsWith("/") ? String(base) : String(base) + "/";
}

async function getJson(url) {
  const resp = await fetch(url, {
    credentials: "same-origin",
    signal: lifecycle.abort ? lifecycle.abort.signal : undefined,
  });
  if (!resp.ok) {
    const err = new Error(`MINERVA request failed: ${resp.status} ${resp.statusText} (${url})`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

/** All pages of a paginated new-API list ({ content, totalPages, number }). */
async function getAllPages(url) {
  const out = [];
  const sep = url.indexOf("?") === -1 ? "?" : "&";
  for (let page = 0; page < 1000; page += 1) {
    const data = await getJson(`${url}${sep}size=10000&page=${page}`);
    const content = Array.isArray(data) ? data : (data && data.content) || [];
    out.push(...content);
    const total = data && typeof data.totalPages === "number" ? data.totalPages : 1;
    if (Array.isArray(data) || page + 1 >= total) break;
  }
  return out;
}

/**
 * Elements of every map (main map and submaps) of the project through the new
 * API. MINERVA 22 names the route "bio_entities", MINERVA 21 "bioEntities";
 * the first one that answers is used for all maps.
 */
async function loadElementsNewApi(projectId) {
  const base = newApiBase();
  if (!base) throw new Error("MINERVA API URL not available");
  const proj = `${base}projects/${encodeURIComponent(projectId)}`;
  const maps = await getAllPages(`${proj}/maps/`);
  const routes = ["bio_entities", "bioEntities"];
  let route = null;
  const all = [];
  for (const map of maps) {
    if (!map || map.id == null) continue;
    let els = null;
    for (const r of route ? [route] : routes) {
      try {
        els = await getAllPages(`${proj}/maps/${map.id}/${r}/elements/`);
        route = r;
        break;
      } catch (e) {
        if (e.status !== 404 || r === routes[routes.length - 1]) throw e;
      }
    }
    // The new API leaves "model" empty on some versions; the map id is known.
    (els || []).forEach((el) => {
      if (el && el.model == null && el.map == null) el.map = map.id;
      all.push(el);
    });
  }
  return all;
}

/**
 * Load all map elements: minerva.elements.data.getAll() when the plugin API
 * provides it (MINERVA 22), otherwise the new REST API (MINERVA 21). The
 * deprecated /api/.../bioEntities/elements/ endpoint is not used.
 */
async function loadElements() {
  const projectId =
    minerva.project && minerva.project.data && minerva.project.data.getProjectId
      ? minerva.project.data.getProjectId()
      : undefined;
  // No project open (e.g. the plugin is run by the admin registration form):
  // nothing to map, and no request is made.
  if (!projectId) return [];
  try {
    if (minerva.elements && minerva.elements.data && typeof minerva.elements.data.getAll === "function") {
      const els = await minerva.elements.data.getAll();
      if (Array.isArray(els) && els.length > 0) return els;
    }
  } catch (e) {
    console.warn("minerva.elements.data.getAll failed, using the MINERVA new API:", e);
  }
  return loadElementsNewApi(projectId);
}

// ===== Registration =====
function register() {
  if (typeof minerva === "undefined" || !minerva.plugins || !minerva.plugins.registerPlugin) {
    alert("MINERVA version not supported. Required version 18.0 or later.");
    return;
  }

  const pluginData = minerva.plugins.registerPlugin({
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
    pluginUrl: PLUGIN_URL,
  });

  // On close: stop pending work, undo every change made to MINERVA's own DOM
  // (hidden host chrome, the positioned .tab-content), remove markers, the
  // resize handler, our listeners and our container (which also carries our
  // <style>), so MINERVA is left exactly as it was.
  const unload = () => {
    lifecycle.unloaded = true;
    if (lifecycle.abort) lifecycle.abort.abort();
    lifecycle.timers.forEach((t) => clearTimeout(t));
    lifecycle.timers = [];
    restoreHost();
    deHighlightAll();
    if (renderUI._resizeHandler) {
      window.removeEventListener("resize", renderUI._resizeHandler);
      renderUI._resizeHandler = null;
    }
    if (renderUI._root) {
      renderUI._root.remove();
      renderUI._root = null;
    }
    try {
      pluginData.events.removeAllListeners();
    } catch (e) {
      /* older MINERVA without removeAllListeners */
    }
  };
  try {
    if (pluginData.events && pluginData.events.addListener) {
      pluginData.events.addListener("onPluginUnload", unload);
    }
  } catch (e) {
    console.warn("onPluginUnload registration skipped:", e);
  }

  Promise.all([fetchSheetData(), loadElements()])
    .then((results) => {
      if (lifecycle.unloaded) return;
      renderUI(pluginData.element, results[0], results[1]);
    })
    .catch((err) => {
      if (lifecycle.unloaded) return;
      $(pluginData.element).html(
        `<p style="color:#b00; padding:12px;">DNT-IVB mapping failed to load: ${escapeHtml(err.message)}</p>`
      );
    });
}

register();
